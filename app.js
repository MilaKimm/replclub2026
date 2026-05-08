(function () {
  'use strict';

  const SIDEBAR_HTML = `
    <aside class="sidebar">
      <a href="index.html" class="brand-link">
        <img src="assets/logo.svg" alt="REPL CLUB" class="brand-logo">
      </a>
      <button type="button" class="nav-toggle" id="navToggle" aria-label="메뉴 열기" aria-expanded="false">
        <span class="nav-toggle-bar"></span>
        <span class="nav-toggle-bar"></span>
        <span class="nav-toggle-bar"></span>
      </button>
      <div class="clock-card">
        <div class="clock-label">현재시간</div>
        <div class="clock" id="clock">--<span class="colon">:</span>--<span class="colon">:</span>--</div>
      </div>
      <ul class="menu" id="menu">
        <li><a href="index.html" data-page="home"><span class="num">01</span> 홈</a></li>
        <li><a href="info.html" data-page="info"><span class="num">02</span> 안내</a></li>
        <li><a href="board.html" data-page="board"><span class="num">03</span> 레플 보드</a></li>
        <li><a href="qa.html" data-page="qa"><span class="num">04</span> 질문 보드</a></li>
      </ul>
      <div class="qr">
        <div class="qr-img">
          <img src="assets/qr.png" alt="QR">
        </div>
        <a href="https://replclub-2026.replit.app/" class="qr-link">replclub-2026.replit.app/</a>
      </div>
    </aside>
  `;

  function injectSidebar(active) {
    const slot = document.getElementById('sidebar-slot');
    if (!slot) return;
    slot.innerHTML = SIDEBAR_HTML;
    if (active) {
      const link = slot.querySelector(`.menu a[data-page="${active}"]`);
      if (link) link.classList.add('active');
    }
    const toggle = slot.querySelector('#navToggle');
    const menu = slot.querySelector('#menu');
    if (toggle && menu) {
      toggle.addEventListener('click', () => {
        const open = menu.classList.toggle('open');
        toggle.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
      });
      // 메뉴 항목 클릭 시 자동 닫기 (모바일 UX)
      menu.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => {
          menu.classList.remove('open');
          toggle.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
        });
      });
    }
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function tickClock() {
    const el = document.getElementById('clock');
    if (!el) return;
    const d = new Date();
    el.innerHTML =
      `${pad(d.getHours())}<span class="colon">:</span>${pad(d.getMinutes())}<span class="colon">:</span>${pad(d.getSeconds())}`;
  }

  // 마감 시간 = 어드민 타임테이블의 '제출 마감' 시간 (index 5).
  // 어드민이 시간 수정하면 localStorage('rc_timetable_times')에 저장됨.
  function getDeadline() {
    const now = new Date();
    let h = 21, m = 45;
    try {
      const raw = localStorage.getItem('rc_timetable_times');
      if (raw) {
        const times = JSON.parse(raw);
        if (Array.isArray(times) && times[5]) {
          const parts = String(times[5]).split(':');
          const ph = parseInt(parts[0]);
          const pm = parseInt(parts[1]);
          if (!isNaN(ph)) h = ph;
          if (!isNaN(pm)) m = pm;
        }
      }
    } catch (e) {}
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d;
  }

  function tickCountdown() {
    const now = new Date();
    let diff = getDeadline() - now;
    let label = '최종 제출 마감까지';
    if (diff <= 0) {
      diff = 0;
      label = '최종 제출 마감';
    }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    const big = document.getElementById('countdown');
    if (big) big.innerHTML = `${h}<small>h</small> ${pad(m)}<small>m</small> ${pad(s)}<small>s</small>`;

    const labelEl = document.querySelector('.countdown-label');
    if (labelEl) labelEl.textContent = label;

    const banner = document.getElementById('bannerCountdown');
    if (banner) banner.textContent = `${h}h ${pad(m)}m ${pad(s)}s`;
  }

  function initReveal() {
    const targets = document.querySelectorAll('[data-reveal]');
    targets.forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = (el.style.transform || '') + ' translateY(8px)';
      setTimeout(() => {
        el.style.transition = 'opacity 0.5s ease, transform 0.5s cubic-bezier(.2,.8,.2,1)';
        el.style.opacity = '1';
        el.style.transform = el.style.transform.replace(' translateY(8px)', '');
      }, 60 * i + 150);
    });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // 어드민이 저장한 타임테이블 시간 가져오기 (없으면 data.js의 기본값 사용)
  function getTimetableData() {
    const base = (window.RC_DATA && window.RC_DATA.timetable) || [];
    let adminTimes = null;
    try {
      const raw = localStorage.getItem('rc_timetable_times');
      if (raw) adminTimes = JSON.parse(raw);
    } catch (e) {}
    return base.map((item, i) => ({
      ...item,
      time: (Array.isArray(adminTimes) && adminTimes[i]) ? adminTimes[i] : item.time,
    }));
  }

  // 현재 시간에 따라 진행 중인 단계 인덱스 계산
  function computeCurrentIdx(items) {
    const now = new Date();
    const nowM = now.getHours() * 60 + now.getMinutes();
    let idx = -1;
    for (let i = 0; i < items.length; i++) {
      const parts = String(items[i].time).split(':').map(n => parseInt(n));
      const m = (parts[0] || 0) * 60 + (parts[1] || 0);
      if (nowM >= m) idx = i;
      else break;
    }
    return idx;
  }

  // 홈 타임테이블 동적 렌더 (현재 시간 기반 자동 진행)
  function renderHomeTimetable() {
    const wrap = document.getElementById('timeline');
    if (!wrap) return;
    const items = getTimetableData();
    if (!items.length) return;

    const currentIdx = computeCurrentIdx(items);

    wrap.innerHTML = items.map((t, i) => {
      const isDone = i < currentIdx;
      const isNow = i === currentIdx;
      const isNext = i === currentIdx + 1;
      const linkHtml = t.link
        ? ` <a class="tl-link" href="${escapeHtml(t.link)}" target="_blank" rel="noopener">📄 발표자료 ↗</a>`
        : '';

      if (isNow) {
        return `<div class="tl-item now">
          <div class="tl-now-block">
            <div class="tl-time">${escapeHtml(t.time)}</div>
            <div>
              <div class="tl-label">${escapeHtml(t.label)}${linkHtml}</div>
              <div class="tl-status" style="margin-top:8px; display:inline-block">▸ NOW</div>
            </div>
          </div>
          <div class="countdown">
            <div class="countdown-label">최종 제출 마감까지</div>
            <div class="countdown-time" id="countdown">--</div>
          </div>
        </div>`;
      }

      const status = isDone ? 'done' : (isNext ? 'next' : 'soon');
      const label = isDone ? 'DONE' : (isNext ? 'UP NEXT' : 'SOON');
      return `<div class="tl-item${isDone ? ' done' : ''}">
        <div class="tl-time">${escapeHtml(t.time)}</div>
        <div class="tl-label">${escapeHtml(t.label)}${linkHtml}</div>
        <div class="tl-status" data-status="${status}">${label}</div>
      </div>`;
    }).join('');
  }

  // 단계 변경 또는 어드민 시간 변경을 감지해 재렌더
  let lastTimetableSig = '';
  function tickTimetable() {
    const wrap = document.getElementById('timeline');
    if (!wrap) return;
    const items = getTimetableData();
    if (!items.length) return;
    const currentIdx = computeCurrentIdx(items);
    const sig = currentIdx + '|' + items.map(t => t.time).join(',');
    if (sig === lastTimetableSig) return;
    lastTimetableSig = sig;
    renderHomeTimetable();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const active = document.body.dataset.page;
    injectSidebar(active);
    tickClock();
    setInterval(tickClock, 1000);
    // 홈 타임테이블 첫 렌더 후 카운트다운 시작 (countdown id가 그 안에 있음)
    renderHomeTimetable();
    lastTimetableSig = (() => {
      const items = getTimetableData();
      return computeCurrentIdx(items) + '|' + items.map(t => t.time).join(',');
    })();
    tickCountdown();
    setInterval(tickCountdown, 1000);
    // 단계 변경 / 어드민 시간 수정 감지 폴링
    setInterval(tickTimetable, 15000); // 15초마다 확인
    initReveal();
  });

  // expose for pages that need
  window.RC = { pad, getDeadline };
})();
