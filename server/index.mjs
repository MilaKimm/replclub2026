import express from "express";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 5000;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

const ALLOWED_KEYS = new Set([
  "rc_projects_2026",
  "rc_qa_2026",
  "rc_comments_2026",
  "rc_attendees_2026",
  "rc_award_phase",
  "rc_timetable_step",
  "rc_timetable_times",
  "rc_notice",
  "rc_config",
]);

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  // 변경 시점마다 직전 값을 스냅샷으로 보존 — 사고 시 복원용
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kv_snapshot (
      id bigserial PRIMARY KEY,
      key text NOT NULL,
      value jsonb NOT NULL,
      reason text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS kv_snapshot_key_created_idx
      ON kv_snapshot (key, created_at DESC);
  `);
}

// 트랜잭션 안에서 호출. 직전(=현재 DB) 값을 스냅샷으로 남김.
// 키당 최근 200개만 유지 (그 이전은 자동 삭제).
async function recordSnapshot(client, key, prevValue, reason) {
  if (prevValue === undefined || prevValue === null) return;
  await client.query(
    "INSERT INTO kv_snapshot (key, value, reason) VALUES ($1, $2::jsonb, $3)",
    [key, JSON.stringify(prevValue), String(reason || "").slice(0, 80)],
  );
  await client.query(
    `DELETE FROM kv_snapshot
     WHERE key = $1 AND id NOT IN (
       SELECT id FROM kv_snapshot WHERE key = $1
       ORDER BY created_at DESC LIMIT 200
     )`,
    [key],
  );
}

function makeEtag(value, updatedAt) {
  const h = createHash("sha1");
  h.update(updatedAt.toISOString());
  h.update("\n");
  h.update(JSON.stringify(value));
  return `W/"${h.digest("hex").slice(0, 16)}"`;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/api/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/kv/:key", async (req, res) => {
  const key = String(req.params.key || "");
  if (!ALLOWED_KEYS.has(key)) {
    return res.status(400).json({ error: "unknown key" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT key, value, updated_at FROM kv_store WHERE key = $1 LIMIT 1",
      [key],
    );
    if (rows.length === 0) {
      res.setHeader("Cache-Control", "no-cache");
      return res.status(200).json({ key, value: null });
    }
    const row = rows[0];
    const etag = makeEtag(row.value, row.updated_at);
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "no-cache");
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }
    res.json({ key: row.key, value: row.value, updatedAt: row.updated_at });
  } catch (err) {
    console.error("GET /api/kv error", err);
    res.status(500).json({ error: "db error" });
  }
});

// 백업 추적이 필요한 키 (PUT 경로에서도 변경 직전 값을 스냅샷으로 보존)
// SNAPSHOT_KEYS 와 동일 목록을 여기서 한번 더 선언하면 순서 의존성이 생기므로
// 함수 내에서 위에 선언된 셋을 직접 참조한다 (hoisting OK — const 셋은 module evaluation 시점에 초기화됨).

app.put("/api/kv/:key", async (req, res) => {
  const key = String(req.params.key || "");
  if (!ALLOWED_KEYS.has(key)) {
    return res.status(400).json({ error: "unknown key" });
  }
  const body = req.body;
  if (body == null || !("value" in body)) {
    return res.status(400).json({ error: "body must be { value: ... }" });
  }
  const value = body.value;
  if (value === undefined || value === null) {
    return res.status(400).json({ error: "value must not be null/undefined" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // 머지 엔드포인트와 동일 키 락을 걸어 동시성 보호
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    // 백업 대상 키면 직전 값을 스냅샷으로 보존 (참석자 CSV 업로드 사고 방지)
    if (SNAPSHOT_KEYS.has(key)) {
      const { rows: prev } = await client.query(
        "SELECT value FROM kv_store WHERE key=$1",
        [key],
      );
      if (prev.length) {
        await recordSnapshot(client, key, prev[0].value, "kv.put");
      }
    }
    const { rows } = await client.query(
      `INSERT INTO kv_store (key, value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING key, value, updated_at`,
      [key, JSON.stringify(value)],
    );
    await client.query("COMMIT");
    const row = rows[0];
    const etag = makeEtag(row.value, row.updated_at);
    res.setHeader("ETag", etag);
    res.json({ key: row.key, value: row.value, updatedAt: row.updated_at });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("PUT /api/kv error", err);
    if (!res.headersSent) res.status(500).json({ error: "db error" });
  } finally {
    client.release();
  }
});

// ============ 충돌 방지 머지 엔드포인트 ============
// 동시 등록/댓글 시 last-write-wins 으로 데이터 유실되는 문제를 막기 위해
// 서버가 트랜잭션 + FOR UPDATE 락 안에서 배열을 병합한다.

async function withProjectsTx(fn, res, reason) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // advisory lock — 행이 없는 경우에도 동시성 보장
    await client.query("SELECT pg_advisory_xact_lock(hashtext('rc_projects_2026'))");
    const { rows } = await client.query(
      "SELECT value FROM kv_store WHERE key = 'rc_projects_2026'",
    );
    let arr = rows.length ? rows[0].value : [];
    if (!Array.isArray(arr)) arr = [];
    const next = await fn(arr, client);
    if (next === undefined) {
      await client.query("ROLLBACK");
      return; // fn 이 res 응답까지 처리함
    }
    // 변경 직전 값 스냅샷 (현재 비어있어도 잘 무시됨)
    if (rows.length) {
      await recordSnapshot(client, "rc_projects_2026", rows[0].value, reason || "projects.tx");
    }
    const { rows: r2 } = await client.query(
      `INSERT INTO kv_store (key, value)
       VALUES ('rc_projects_2026', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING value, updated_at`,
      [JSON.stringify(next)],
    );
    await client.query("COMMIT");
    const row = r2[0];
    const etag = makeEtag(row.value, row.updated_at);
    res.setHeader("ETag", etag);
    res.json({ value: row.value, updatedAt: row.updated_at });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("projects tx error", err);
    if (!res.headersSent) res.status(500).json({ error: "db error" });
  } finally {
    client.release();
  }
}

// 신규 등록 또는 수정 (id 기준 머지). 수정 시 비밀번호 검증.
app.post("/api/projects/upsert", async (req, res) => {
  const project = req.body && req.body.project;
  if (!project || typeof project !== "object" || !project.id || !project.team) {
    return res.status(400).json({ error: "invalid project" });
  }
  await withProjectsTx(async (arr) => {
    const idx = arr.findIndex((p) => p && p.id === project.id);
    if (idx >= 0) {
      const existing = arr[idx];
      if (existing._password && existing._password !== project._password) {
        res.status(403).json({ error: "비밀번호가 일치하지 않습니다" });
        return undefined;
      }
      arr[idx] = { ...existing, ...project };
    } else {
      arr.push(project);
    }
    return arr;
  }, res, "projects.upsert");
});

// 삭제 (비밀번호 검증)
app.post("/api/projects/delete", async (req, res) => {
  const { id, password } = req.body || {};
  if (!id) return res.status(400).json({ error: "id required" });
  await withProjectsTx(async (arr) => {
    const idx = arr.findIndex((p) => p && p.id === id);
    if (idx < 0) {
      res.status(404).json({ error: "프로젝트를 찾을 수 없습니다" });
      return undefined;
    }
    const existing = arr[idx];
    if (existing._password && existing._password !== password) {
      res.status(403).json({ error: "비밀번호가 일치하지 않습니다" });
      return undefined;
    }
    arr.splice(idx, 1);
    return arr;
  }, res, "projects.delete");
});

// 댓글 추가 (트랜잭션 안에서 객체에 append)
app.post("/api/comments/append", async (req, res) => {
  const { projectId, comment } = req.body || {};
  if (!projectId || !comment || !comment.name || !comment.body) {
    return res.status(400).json({ error: "invalid comment" });
  }
  const safeComment = {
    name: String(comment.name).slice(0, 60),
    body: String(comment.body).slice(0, 500),
    time: String(comment.time || "").slice(0, 10),
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('rc_comments_2026'))");
    const { rows } = await client.query(
      "SELECT value FROM kv_store WHERE key = 'rc_comments_2026'",
    );
    let obj = rows.length ? rows[0].value : {};
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) obj = {};
    const arr = Array.isArray(obj[projectId]) ? obj[projectId].slice() : [];
    arr.push(safeComment);
    obj[projectId] = arr;
    if (rows.length) {
      await recordSnapshot(client, "rc_comments_2026", rows[0].value, "comments.append");
    }
    const { rows: r2 } = await client.query(
      `INSERT INTO kv_store (key, value)
       VALUES ('rc_comments_2026', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING value, updated_at`,
      [JSON.stringify(obj)],
    );
    await client.query("COMMIT");
    const row = r2[0];
    const etag = makeEtag(row.value, row.updated_at);
    res.setHeader("ETag", etag);
    res.json({ value: row.value, updatedAt: row.updated_at });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("comments tx error", err);
    if (!res.headersSent) res.status(500).json({ error: "db error" });
  } finally {
    client.release();
  }
});

// ===== 어드민 전용 (비번 검증 생략) — 어드민 URL 자체가 액세스 경계 =====
app.post("/api/admin/projects/upsert", async (req, res) => {
  const project = req.body && req.body.project;
  if (!project || !project.id || !project.team) {
    return res.status(400).json({ error: "invalid project" });
  }
  await withProjectsTx(async (arr) => {
    const idx = arr.findIndex((p) => p && p.id === project.id);
    if (idx >= 0) arr[idx] = { ...arr[idx], ...project };
    else arr.push(project);
    return arr;
  }, res, "admin.projects.upsert");
});

app.post("/api/admin/projects/delete", async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "id required" });
  await withProjectsTx(async (arr) => {
    const idx = arr.findIndex((p) => p && p.id === id);
    if (idx < 0) {
      res.status(404).json({ error: "프로젝트를 찾을 수 없습니다" });
      return undefined;
    }
    arr.splice(idx, 1);
    return arr;
  }, res, "admin.projects.delete");
});

// ===== Q&A 머지 헬퍼 + 엔드포인트 =====
async function withQaTx(fn, res, reason) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('rc_qa_2026'))");
    const { rows } = await client.query(
      "SELECT value FROM kv_store WHERE key = 'rc_qa_2026'",
    );
    let arr = rows.length ? rows[0].value : [];
    if (!Array.isArray(arr)) arr = [];
    const next = await fn(arr);
    if (next === undefined) {
      await client.query("ROLLBACK");
      return;
    }
    if (rows.length) {
      await recordSnapshot(client, "rc_qa_2026", rows[0].value, reason || "qa.tx");
    }
    const { rows: r2 } = await client.query(
      `INSERT INTO kv_store (key, value)
       VALUES ('rc_qa_2026', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING value, updated_at`,
      [JSON.stringify(next)],
    );
    await client.query("COMMIT");
    const row = r2[0];
    const etag = makeEtag(row.value, row.updated_at);
    res.setHeader("ETag", etag);
    res.json({ value: row.value, updatedAt: row.updated_at });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("qa tx error", err);
    if (!res.headersSent) res.status(500).json({ error: "db error" });
  } finally {
    client.release();
  }
}

// 참가자: 새 질문 등록 / 어드민: 답변 추가·수정 (id 머지)
app.post("/api/qa/upsert", async (req, res) => {
  const item = req.body && req.body.item;
  if (!item || typeof item !== "object" || !item.id) {
    return res.status(400).json({ error: "invalid qa item" });
  }
  // 기본 길이 가드
  const safe = {
    id: String(item.id).slice(0, 40),
    author: item.author != null ? String(item.author).slice(0, 60) : undefined,
    time: item.time != null ? String(item.time).slice(0, 10) : undefined,
    body: item.body != null ? String(item.body).slice(0, 1000) : undefined,
    reply: item.reply === null ? null
      : (item.reply && typeof item.reply === "object"
          ? {
              body: String(item.reply.body || "").slice(0, 1000),
              time: String(item.reply.time || "").slice(0, 10),
            }
          : undefined),
  };
  await withQaTx(async (arr) => {
    const idx = arr.findIndex((q) => q && q.id === safe.id);
    if (idx >= 0) {
      const merged = { ...arr[idx] };
      for (const k of Object.keys(safe)) {
        if (safe[k] !== undefined) merged[k] = safe[k];
      }
      arr[idx] = merged;
    } else {
      arr.push({
        id: safe.id,
        author: safe.author || "익명",
        time: safe.time || "",
        body: safe.body || "",
        reply: safe.reply || null,
      });
    }
    return arr;
  }, res, "qa.upsert");
});

// 어드민: 질문 삭제
app.post("/api/qa/delete", async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "id required" });
  await withQaTx(async (arr) => arr.filter((q) => q && q.id !== id), res, "qa.delete");
});

// ===== 어드민: 백업 / 복원 =====
// 모든 머지 트랜잭션은 변경 직전 값을 kv_snapshot 에 저장한다.
// 어드민이 사고 시 임의 시점으로 되돌릴 수 있게 목록·복원·수동 스냅샷 제공.

const SNAPSHOT_KEYS = new Set([
  "rc_projects_2026",
  "rc_qa_2026",
  "rc_comments_2026",
  "rc_attendees_2026",
]);

app.get("/api/admin/snapshots", async (req, res) => {
  const key = String(req.query.key || "");
  if (!SNAPSHOT_KEYS.has(key)) return res.status(400).json({ error: "unknown key" });
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
  try {
    const { rows } = await pool.query(
      `SELECT id, reason, created_at,
              CASE WHEN jsonb_typeof(value)='array' THEN jsonb_array_length(value) END AS items,
              length(value::text) AS bytes
       FROM kv_snapshot WHERE key=$1 ORDER BY created_at DESC LIMIT $2`,
      [key, limit],
    );
    res.json({ key, snapshots: rows });
  } catch (err) {
    console.error("snapshots list error", err);
    res.status(500).json({ error: "db error" });
  }
});

app.get("/api/admin/snapshots/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: "id required" });
  try {
    const { rows } = await pool.query(
      "SELECT id, key, value, reason, created_at FROM kv_snapshot WHERE id=$1",
      [id],
    );
    if (!rows.length) return res.status(404).json({ error: "not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("snapshot get error", err);
    res.status(500).json({ error: "db error" });
  }
});

// 수동 스냅샷 (현재 값을 즉시 백업)
app.post("/api/admin/snapshot", async (req, res) => {
  const { key, reason } = req.body || {};
  if (!SNAPSHOT_KEYS.has(key)) return res.status(400).json({ error: "unknown key" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT value FROM kv_store WHERE key=$1",
      [key],
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "현재 값이 없습니다" });
    }
    await recordSnapshot(client, key, rows[0].value, reason || "manual");
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("manual snapshot error", err);
    res.status(500).json({ error: "db error" });
  } finally {
    client.release();
  }
});

// 복원 — 현재 값을 한번 더 스냅샷으로 보존한 뒤 덮어쓴다.
app.post("/api/admin/restore", async (req, res) => {
  const id = parseInt(req.body && req.body.id);
  if (!id) return res.status(400).json({ error: "snapshot id required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: snap } = await client.query(
      "SELECT key, value FROM kv_snapshot WHERE id=$1",
      [id],
    );
    if (!snap.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "스냅샷을 찾을 수 없습니다" });
    }
    const { key, value } = snap[0];
    if (!SNAPSHOT_KEYS.has(key)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "복원 불가 키" });
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    const { rows: cur } = await client.query(
      "SELECT value FROM kv_store WHERE key=$1",
      [key],
    );
    if (cur.length) {
      await recordSnapshot(client, key, cur[0].value, "pre-restore");
    }
    await client.query(
      `INSERT INTO kv_store (key, value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
    await client.query("COMMIT");
    res.json({ ok: true, key, restoredFrom: id });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("restore error", err);
    res.status(500).json({ error: "db error" });
  } finally {
    client.release();
  }
});

// Static files (root + replclubadmin2026/)
app.use(
  express.static(ROOT, {
    extensions: ["html"],
    setHeaders: (res, filePath) => {
      // HTML / JS / CSS는 즉시 갱신 반영을 위해 no-cache, 이미지/폰트는 짧은 캐시
      if (/\.(html|js|css|json)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache");
      } else {
        res.setHeader("Cache-Control", "public, max-age=300");
      }
    },
  }),
);

// SPA fallback unnecessary — multi-page static. 404 = 404.

initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`REPL CLUB server listening on :${PORT}`);
    });
  })
  .catch((err) => {
    console.error("DB init failed:", err);
    process.exit(1);
  });
