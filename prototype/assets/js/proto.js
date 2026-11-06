/* 仕兔平台原型 — 交互脚手架 */
(function () {
  'use strict';

  /* ---------- toast ---------- */
  var toastEl;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 2000);
  }
  window.toast = toast;

  /* ---------- mobile canvas: screen navigation ---------- */
  function setActiveScreen(id, scroll) {
    var el = document.getElementById(id);
    if (!el) return;
    document.querySelectorAll('.device.active').forEach(function (d) { d.classList.remove('active'); });
    el.classList.add('active');
    document.querySelectorAll('.rail-nav a').forEach(function (a) {
      a.classList.toggle('on', a.getAttribute('href') === '#' + id);
    });
    if (scroll !== false) {
      if (document.body.classList.contains('demo')) window.scrollTo({ top: 0, behavior: 'smooth' });
      else el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    var vp = el.querySelector('.vp'); if (vp) vp.scrollTop = 0;
    history.replaceState(null, '', '#' + id);
  }
  window.setActiveScreen = setActiveScreen;

  document.addEventListener('click', function (e) {
    /* goto another mobile screen */
    var g = e.target.closest('[data-goto]');
    if (g) {
      e.preventDefault();
      setActiveScreen(g.getAttribute('data-goto'));
      return;
    }
    /* rail nav */
    var rl = e.target.closest('.rail-nav a');
    if (rl) {
      e.preventDefault();
      setActiveScreen(rl.getAttribute('href').slice(1));
      return;
    }
    /* view switch (console) */
    var nv = e.target.closest('[data-view]');
    if (nv) {
      e.preventDefault();
      var v = nv.getAttribute('data-view');
      document.querySelectorAll('.view').forEach(function (s) { s.classList.toggle('on', s.id === 'v-' + v); });
      document.querySelectorAll('[data-view]').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-view') === v && a.closest('.side-nav')); });
      var t = document.getElementById('crumb-title');
      if (t && nv.dataset.title) t.textContent = nv.dataset.title;
      var sec = document.getElementById('crumb-sec');
      if (sec && nv.dataset.sec) sec.textContent = nv.dataset.sec;
      window.scrollTo({ top: 0 });
      history.replaceState(null, '', '#' + v);
      return;
    }
    /* generic tab groups */
    var tb = e.target.closest('[data-tab]');
    if (tb) {
      var grp = tb.closest('[data-tabgroup]');
      if (grp) {
        grp.querySelectorAll('[data-tab]').forEach(function (b) { b.classList.toggle('on', b === tb); });
        var key = tb.getAttribute('data-tab');
        var host = document.querySelector('[data-tabpanels="' + grp.getAttribute('data-tabgroup') + '"]');
        if (host) host.querySelectorAll('[data-panel]').forEach(function (p) {
          p.style.display = (p.getAttribute('data-panel') === key) ? '' : 'none';
        });
      }
    }
    /* option select (single choice group) */
    var op = e.target.closest('.qopt');
    if (op && op.parentElement) {
      op.parentElement.querySelectorAll('.qopt').forEach(function (o) { o.classList.remove('sel'); });
      op.classList.add('sel');
    }
    /* switch toggle */
    var sw = e.target.closest('.switch');
    if (sw) sw.classList.toggle('on');

    /* open drawer / modal */
    var op2 = e.target.closest('[data-open]');
    if (op2) {
      e.preventDefault();
      var tgt = document.getElementById(op2.getAttribute('data-open'));
      if (tgt) { tgt.classList.add('show'); document.querySelector('.mask') && document.querySelector('.mask').classList.add('show'); }
      return;
    }
    if (e.target.closest('[data-close]') || e.target.classList.contains('mask')) {
      document.querySelectorAll('.drawer.show,.modal.show,.mask.show').forEach(function (d) { d.classList.remove('show'); });
    }
    /* demo-only feedback */
    var dm = e.target.closest('[data-demo]');
    if (dm) { toast(dm.getAttribute('data-demo')); }
  });

  /* ---------- mode switch (canvas / demo) ---------- */
  window.setMode = function (mode) {
    document.body.classList.toggle('demo', mode === 'demo');
    document.querySelectorAll('.seg button').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === mode); });
    if (mode === 'demo' && !document.querySelector('.device.active')) {
      var first = document.querySelector('.device');
      if (first) setActiveScreen(first.id);
    }
    window.scrollTo({ top: 0 });
  };

  /* ---------- init ---------- */
  function activateView(key) {
    var target = document.getElementById('v-' + key);
    if (!target) return false;
    document.querySelectorAll('.view').forEach(function (s) { s.classList.toggle('on', s === target); });
    var link = document.querySelector('.side-nav [data-view="' + key + '"]');
    document.querySelectorAll('.side-nav [data-view]').forEach(function (a) { a.classList.toggle('on', a === link); });
    if (link) {
      var t = document.getElementById('crumb-title');
      var sec = document.getElementById('crumb-sec');
      if (t && link.dataset.title) t.textContent = link.dataset.title;
      if (sec && link.dataset.sec) sec.textContent = link.dataset.sec;
    }
    return true;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var h = location.hash.slice(1);
    if (h) {
      var el = document.getElementById(h);
      if (el && el.classList.contains('device')) setActiveScreen(h);
      else activateView(h);
    }
    if (document.querySelector('.device') && !document.querySelector('.device.active')) {
      document.querySelector('.device').classList.add('active');
    }
    /* stagger reveal */
    document.querySelectorAll('[data-rise]').forEach(function (el, i) {
      el.classList.add('rise'); el.style.animationDelay = (i * 45) + 'ms';
    });
  });
})();
