// REPL CLUB - 서버 동기화 헬퍼 (8 keys)
// localStorage 캐시 + 5초 ETag 폴링 + put 시 즉시 서버 반영
// 오프라인 대비: 서버 실패해도 localStorage 는 유지
(function (global) {
  'use strict';

  var ALLOWED = {
    rc_projects_2026: 1,
    rc_qa_2026: 1,
    rc_comments_2026: 1,
    rc_attendees_2026: 1,
    rc_award_phase: 1,
    rc_timetable_step: 1,
    rc_timetable_times: 1,
    rc_notice: 1,
    rc_config: 1,
  };

  var etags = {};
  var subs = {};
  var inFlight = {};
  var seeded = {};
  var activeKeys = {};
  var pollTimer = null;
  var POLL_MS = 5000;

  function isStr(v) { return typeof v === 'string'; }

  function readLocal(key) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return undefined;
      try { return JSON.parse(raw); } catch (e) { return raw; }
    } catch (e) { return undefined; }
  }

  function writeLocal(key, value) {
    try {
      if (value === undefined || value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, isStr(value) ? value : JSON.stringify(value));
      }
    } catch (e) {}
  }

  function notify(key, value) {
    var arr = subs[key] || [];
    for (var i = 0; i < arr.length; i++) {
      try { arr[i](value); } catch (e) {}
    }
  }

  function setStatus(online) {
    try {
      var el = document.getElementById('syncStatus');
      if (!el) return;
      el.textContent = online ? '' : '⚠ 오프라인 (마지막 동기화 데이터 표시)';
      el.style.color = online ? '' : '#c00';
    } catch (e) {}
  }

  async function refresh(key) {
    if (!ALLOWED[key]) return;
    if (inFlight[key]) return;
    inFlight[key] = true;
    try {
      var headers = {};
      if (etags[key]) headers['If-None-Match'] = etags[key];
      var res = await fetch('/api/kv/' + encodeURIComponent(key), {
        headers: headers,
        credentials: 'same-origin',
      });
      setStatus(true);
      if (res.status === 304) return;
      if (res.status === 404) {
        // 서버에 데이터 없음 → 첫 1회만, 로컬 캐시가 있으면 시드
        if (!seeded[key]) {
          seeded[key] = true;
          var local = readLocal(key);
          if (local !== undefined) {
            await put(key, local, { silent: true });
          }
        }
        return;
      }
      if (!res.ok) return;
      var tag = res.headers.get('ETag');
      if (tag) etags[key] = tag;
      var json = await res.json();
      var nextStr;
      if (json.value === null || json.value === undefined) nextStr = null;
      else nextStr = isStr(json.value) ? json.value : JSON.stringify(json.value);
      var prevStr = null;
      try { prevStr = localStorage.getItem(key); } catch (e) {}
      if (prevStr !== nextStr) {
        try {
          if (nextStr === null) localStorage.removeItem(key);
          else localStorage.setItem(key, nextStr);
        } catch (e) {}
        notify(key, json.value);
      }
    } catch (e) {
      setStatus(false);
    } finally {
      inFlight[key] = false;
    }
  }

  async function put(key, value, opts) {
    if (!ALLOWED[key]) throw new Error('unknown sync key: ' + key);
    opts = opts || {};
    writeLocal(key, value); // 낙관적 업데이트
    if (!opts.silent) notify(key, value);
    try {
      var res = await fetch('/api/kv/' + encodeURIComponent(key), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ value: value }),
      });
      if (res.ok) {
        var tag = res.headers.get('ETag');
        if (tag) etags[key] = tag;
        seeded[key] = true;
        setStatus(true);
        return true;
      }
      setStatus(false);
      return false;
    } catch (e) {
      setStatus(false);
      return false;
    }
  }

  function get(key) {
    return readLocal(key);
  }

  function on(key, fn) {
    (subs[key] = subs[key] || []).push(fn);
    return function () {
      subs[key] = (subs[key] || []).filter(function (f) { return f !== fn; });
    };
  }

  function stop() {
    if (pollTimer) {
      try { clearInterval(pollTimer); } catch (e) {}
      pollTimer = null;
    }
  }

  function start(keys) {
    if (Array.isArray(keys)) {
      for (var i = 0; i < keys.length; i++) activeKeys[keys[i]] = 1;
    }
    // 즉시 1회
    Object.keys(activeKeys).forEach(function (k) { refresh(k); });
    // SPA 라우팅에서 외부에서 interval이 clear됐을 수 있으므로 항상 재생성
    stop();
    pollTimer = setInterval(function () {
      Object.keys(activeKeys).forEach(function (k) { refresh(k); });
    }, POLL_MS);
  }

  global.RCSync = {
    start: start,
    stop: stop,
    refresh: refresh,
    put: put,
    get: get,
    on: on,
  };
})(window);
