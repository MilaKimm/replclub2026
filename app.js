(function () {
  'use strict';

  const SIDEBAR_HTML = `
    <aside class="sidebar">
      <a href="index.html" class="brand-link">
        <img src="assets/logo.svg" alt="REPL CLUB" class="brand-logo">
      </a>
      <div class="clock-card">
        <div class="clock-label">현재시간</div>
        <div class="clock" id="clock">--<span class="colon">:</span>--<span class="colon">:</span>--</div>
      </div>
      <ul class="menu">
        <li><a href="index.html" data-page="home"><span class="num">01</span> 홈</a></li>
        <li><a href="info.html" data-page="info"><span class="num">02</span> 안내</a></li>
        <li><a href="board.html" data-page="board"><span class="num">03</span> 레플 보드</a></li>
        <li><a href="qa.html" data-page="qa"><span class="num">04</span> 질문 보드</a></li>
      </ul>
      <div class="qr">
        <div class="qr-img">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=https%3A%2F%2Freplclub2026.vercel.app" alt="QR">
        </div>
        <a href="https://replclub2026.vercel.app" class="qr-link">replclub2026.vercel.app</a>
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
    let label = '제출 마감까지';
    if (diff <= 0) {
      diff = 0;
      label = '제출 마감';
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

  // 어드민이 저장한 타임테이블 시간 → .tl-time 텍스트에 적용
  function applyCustomTimetableTimes() {
    try {
      const raw = localStorage.getItem('rc_timetable_times');
      if (!raw) return;
      const times = JSON.parse(raw);
      if (!Array.isArray(times)) return;
      document.querySelectorAll('.tl-item .tl-time').forEach((el, i) => {
        if (times[i]) el.textContent = times[i];
      });
    } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    const active = document.body.dataset.page;
    injectSidebar(active);
    tickClock();
    tickCountdown();
    setInterval(tickClock, 1000);
    setInterval(tickCountdown, 1000);
    initReveal();
    applyCustomTimetableTimes();
  });

  // expose for pages that need
  window.RC = { pad, getDeadline };
})();
