/* Nexus 2.0 — phone app (app.html): one person's own tasks and their score, nothing else.
   It loads the same code as the full Nexus, so a task closed here follows exactly the same rules. */
'use strict';
if (window.NX_APP === 'mobile') (function () {
  const MOB = { f: 'open', push: '' };
  const MOB_VIEWS = { mytasks: 1, myscore: 1 };
  const stCls = { Delayed: 'Late', Pending: 'Pending', Upcoming: 'Waiting', Completed: 'Done', 'Not done': 'Late', Excused: 'Cancelled' };
  // the Nexus activity links open the full Nexus in a browser tab
  const fixBtn = t => t.src === 'Nexus' && t.btn ? t.btn.replace(/href="#\//, 'href="index.html#/').replace('<a ', '<a target="_blank" rel="noopener" ') : (t.btn || '');

  /* ---- install + notifications ---- */
  function mobPushRead() { if (typeof pushState !== 'function') { MOB.push = 'na'; return; } pushState().then(v => { if (v !== MOB.push) { MOB.push = v; const w = curView().v; if (VIEWS[w] && (w === 'mytasks' || w === 'myscore')) VIEWS[w].render(); } }); }
  // shown on My tasks only while something still needs doing; the full switch lives on My score
  const mobStandalone = () => !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const mobIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function mobNudge() {
    let h = '';
    // notifications first: this is the one thing a person must switch on, and it is easy to miss
    if (MOB.push === 'off') h += '<div class="mb-note big"><span><b>Notifications are off on this phone.</b><br>Switch them on and you will be told the moment a new task comes to you.</span><a class="btn" data-act="mb-push-on">Turn on notifications</a></div>';
    else if (MOB.push === 'blocked') h += '<div class="mb-note big"><span><b>Notifications are blocked for Nexus in this browser.</b><br>Browser settings → Site settings → Notifications → allow nexus, then open this screen again.</span></div>';
    else if (MOB.push === 'na') h += '<div class="mb-note"><span>This browser cannot show notifications. Open the app from the home screen icon.</span></div>';
    if (typeof PUSH === 'object' && PUSH.install) h += '<div class="mb-note"><span>Install Nexus on this phone so it opens like an app.</span><a class="btn sm" data-act="mb-install">Install</a></div>';
    else if (mobIos() && !mobStandalone()) h += '<div class="mb-note"><span>iPhone: tap Share, then Add to Home Screen. Open Nexus from there — on an iPhone notifications work only from the home screen app.</span></div>';
    return h;
  }
  function mobPushCard() {
    const st = MOB.push;
    const row = st === 'on' ? '<span class="st Done">On</span><a class="btn ghost sm" data-act="mb-push-test">Send a test</a><a class="btn ghost sm" data-act="mb-push-off">Turn off</a>'
      : st === 'blocked' ? '<span class="st Late">Blocked in the browser</span>'
        : st === 'na' ? '<span class="st Waiting">Not available in this browser</span>'
          : '<span class="st Pending">Off</span><a class="btn sm" data-act="mb-push-on">Turn on</a>';
    return '<div class="card"><div class="mb-set"><b>Task notifications</b><div class="mb-set-r">' + row + '</div></div>' +
      (typeof PUSH === 'object' && PUSH.install ? '<div class="mb-set"><b>Install the app</b><div class="mb-set-r"><a class="btn sm" data-act="mb-install">Install</a></div></div>'
        : mobIos() && !mobStandalone() ? '<div class="mb-set"><b>Install the app</b><div class="mb-set-r"><span class="small">Share → Add to Home Screen</span></div></div>'
          : mobStandalone() ? '<div class="mb-set"><b>Install the app</b><div class="mb-set-r"><span class="st Done">Installed</span></div></div>' : '') + '</div>';
  }
  ACTIONS['mb-install'] = async () => {
    if (!PUSH.install) { flash('Use the browser menu: Add to Home screen.', 'warn'); return; }
    const e = PUSH.install; PUSH.install = null;
    try { e.prompt(); const r = await e.userChoice; flash(r && r.outcome === 'accepted' ? 'Installing — look for Nexus on your home screen.' : 'Not installed.', r && r.outcome === 'accepted' ? 'ok' : 'warn'); } catch (err) { flash(esc(err.message), 'err'); }
    VIEWS[curView().v].render();
  };
  ACTIONS['mb-push-on'] = async el => {
    el.classList.add('busy');
    try { await pushEnable(); MOB.push = 'on'; flash('Notifications are on for this phone.', 'ok'); }
    catch (e) { MOB.push = await pushState(); flash(esc(e.message), 'err'); }
    VIEWS[curView().v].render();
  };
  ACTIONS['mb-push-off'] = async () => { try { await pushDisable(); } catch (e) { } MOB.push = 'off'; flash('Notifications are off for this phone.', 'ok'); VIEWS[curView().v].render(); };
  ACTIONS['mb-push-test'] = async () => { try { const r = await pushTest(); flash(r.sent ? 'Test sent.' : 'This phone is not registered any more — turn notifications on again.', r.sent ? 'ok' : 'warn'); if (!r.sent) { MOB.push = 'off'; VIEWS[curView().v].render(); } } catch (e) { flash(esc(e.message), 'err'); } };

  VIEWS.mytasks = {
    mod: 'tasks', render() {
      const all = personTasks(ME.doer || '');
      const n = k => k === 'open' ? all.filter(t => t.status !== 'Completed' && t.status !== 'Excused').length : all.filter(t => t.status === k).length;
      const list = all.filter(t => MOB.f === 'open' ? (t.status !== 'Completed' && t.status !== 'Excused') : t.status === MOB.f)
        .sort((a, b) => { const o = { Delayed: 0, 'Not done': 1, Pending: 2, Upcoming: 3, Completed: 4, Excused: 5 }; return (o[a.status] - o[b.status]) || (b.delay || 0) - (a.delay || 0) || (a.planned || 0) - (b.planned || 0); });
      const chip = (v, l) => '<a class="mb-chip' + (MOB.f === v ? ' on' : '') + '" data-act="mb-f" data-v="' + v + '">' + l + ' ' + n(v) + '</a>';
      if (MOB.push === '') mobPushRead();
      setMain(mobNudge() + '<div class="mb-chips">' + chip('open', 'Open') + chip('Delayed', 'Late') + chip('Pending', 'Today') + chip('Upcoming', 'Later') + chip('Completed', 'Done') + '</div>' +
        (list.length ? list.map(t => '<div class="mb-card' + (t.status === 'Delayed' || t.status === 'Not done' ? ' late' : '') + '">' +
          '<div class="mb-t">' + esc(t.task) + '</div>' +
          '<div class="mb-m">' + esc([t.src, t.ref, t.party].filter(Boolean).join(' · ')) + '</div>' +
          (t.photos && t.photos.length ? '<div class="mb-ph">' + t.photos.slice(0, 3).map(photoThumb).join(' ') + '</div>' : '') +
          '<div class="mb-r"><span class="st ' + (stCls[t.status] || 'Waiting') + '">' + esc(t.status) + '</span>' +
          (t.planned ? '<span class="mb-d">' + fmtDT(t.planned) + '</span>' : '') +
          (t.delay ? '<span class="late-txt mb-d">' + fmtDelay(t.delay) + ' late</span>' : '') +
          (t.why ? '<span class="mb-d">' + esc(t.why) + '</span>' : '') + '</div>' +
          (fixBtn(t) ? '<div class="mb-a">' + fixBtn(t) + '</div>' : '') + '</div>').join('')
          : '<div class="mb-empty">' + (MOB.f === 'open' ? 'Nothing open — well done.' : 'Nothing here.') + '</div>'));
    }
  };
  VIEWS.myscore = {
    mod: 'dashboard', render() {
      if (MOB.push === '') mobPushRead();
      const sc = scoreOf(ME.doer, 30, true);
      const open = personTasks(ME.doer || '');
      const k = (l, v, c) => '<div class="mb-k"><b class="' + (c || '') + '">' + v + '</b><i>' + l + '</i></div>';
      setMain('<div class="mb-kpi">' + k('Score · 30 days', sc ? sc.score.toFixed(2) : '—', sc ? scoreCls(sc.score) : '') +
        k('Delayed', open.filter(t => t.status === 'Delayed').length, 'late-txt') + k('Today', open.filter(t => t.status === 'Pending').length) +
        k('Done · 30 days', open.filter(t => t.status === 'Completed').length, 'done-txt') + '</div>' +
        myScoreCard(ME.doer) + (typeof teamCard === 'function' ? teamCard(ME.doer) : '') + mobPushCard());
    }
  };
  ACTIONS['mb-f'] = el => { MOB.f = el.dataset.v; VIEWS.mytasks.render(); };
  // the sidebar becomes the bottom bar; nothing else is reachable in the app
  renderNav = function () {
    const v = curView().v; const c = navCounts();
    const tab = (to, l, ic, cnt) => '<a href="#/' + to + '" class="' + (v === to ? 'on' : '') + '"><svg viewBox="0 0 24 24">' + ic + '</svg><span>' + l + '</span>' + (cnt ? '<i>' + cnt + '</i>' : '') + '</a>';
    $('#nav').innerHTML = tab('mytasks', 'My tasks', '<path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', c.tasks && c.tasks.n) +
      tab('myscore', 'My score', '<path d="M4 19V10M10 19V5M16 19v-6M22 19H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', 0);
    const w = $('#who'); if (w) w.textContent = ME.name || '';
  };
  // nothing else is reachable here: every other screen just sends the person back to their tasks
  VIEWS.home = VIEWS.mytasks;
  NAV.length = 0;   // the app has its own two tabs, so the full menu is gone
  Object.keys(VIEWS).forEach(k => { if (!MOB_VIEWS[k] && k !== 'home') VIEWS[k] = { mod: 'dashboard', render() { go('mytasks'); } }; });
})();
