(function () {
  'use strict';

  const SIDEBAR_HTML = `
    <aside class="sidebar">
      <div>
        <div class="brand-row">
          <div class="brand-mark"><span></span><span></span><span></span><span></span></div>
          <div class="brand">REPL<br>CLUB</div>
        </div>
      </div>
      <div class="clock-card">
        <div class="clock-label">SEOUL · KST</div>
        <div class="clock" id="clock">--<span class="colon">:</span>--<span class="colon">:</span>--</div>
      </div>
      <ul class="menu">
        <li><a href="index.html" data-page="home"><span class="num">01</span> 홈</a></li>
        <li><a href="board.html" data-page="board"><span class="num">02</span> 레플 보드</a></li>
        <li><a href="qa.html" data-page="qa"><span class="num">03</span> 질문 보드</a></li>
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

  // 마감 시간 (행사 당일 21:45). 데모용으로 현재 날짜의 21:45로 설정.
  function getDeadline() {
    const now = new Date();
    const d = new Date(now);
    d.setHours(21, 45, 0, 0);
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
    if (banner) banner.textContent = `${h}h ${pad(m)}m`;
  }

  function initAdminEntry() {
    const entry = document.querySelector('.admin-entry');
    const link = document.querySelector('.admin-entry-link');
    if (!entry || !link) return;
    entry.addEventListener('click', (e) => {
      e.stopPropagation();
      link.classList.toggle('show');
    });
    document.addEventListener('click', (e) => {
      if (!link.contains(e.target) && e.target !== entry) {
        link.classList.remove('show');
      }
    });
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

  document.addEventListener('DOMContentLoaded', () => {
    const active = document.body.dataset.page;
    injectSidebar(active);
    tickClock();
    tickCountdown();
    setInterval(tickClock, 1000);
    setInterval(tickCountdown, 1000);
    initAdminEntry();
    initReveal();
  });

  // expose for pages that need
  window.RC = { pad, getDeadline };
})();
