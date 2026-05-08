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
  try {
    const { rows } = await pool.query(
      `INSERT INTO kv_store (key, value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING key, value, updated_at`,
      [key, JSON.stringify(value)],
    );
    const row = rows[0];
    const etag = makeEtag(row.value, row.updated_at);
    res.setHeader("ETag", etag);
    res.json({ key: row.key, value: row.value, updatedAt: row.updated_at });
  } catch (err) {
    console.error("PUT /api/kv error", err);
    res.status(500).json({ error: "db error" });
  }
});

// ============ 충돌 방지 머지 엔드포인트 ============
// 동시 등록/댓글 시 last-write-wins 으로 데이터 유실되는 문제를 막기 위해
// 서버가 트랜잭션 + FOR UPDATE 락 안에서 배열을 병합한다.

async function withProjectsTx(fn, res) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT value FROM kv_store WHERE key = 'rc_projects_2026' FOR UPDATE",
    );
    let arr = rows.length ? rows[0].value : [];
    if (!Array.isArray(arr)) arr = [];
    const next = await fn(arr, client);
    if (next === undefined) {
      await client.query("ROLLBACK");
      return; // fn 이 res 응답까지 처리함
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
  }, res);
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
  }, res);
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
    const { rows } = await client.query(
      "SELECT value FROM kv_store WHERE key = 'rc_comments_2026' FOR UPDATE",
    );
    let obj = rows.length ? rows[0].value : {};
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) obj = {};
    const arr = Array.isArray(obj[projectId]) ? obj[projectId].slice() : [];
    arr.push(safeComment);
    obj[projectId] = arr;
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
