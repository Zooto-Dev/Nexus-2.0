/* Nexus 2.0 — phone app (app.html): one person's own tasks and their score, nothing else.
   It loads the same code as the full Nexus, so a task closed here follows exactly the same rules. */
'use strict';
if (window.NX_APP === 'mobile') (function () {
  const MOB = { f: 'open' };
  const MOB_VIEWS = { mytasks: 1, myscore: 1 };
  const stCls = { Delayed: 'Late', Pending: 'Pending', Upcoming: 'Waiting', Completed: 'Done', 'Not done': 'Late', Excused: 'Cancelled' };
  // the Nexus activity links open the full Nexus in a browser tab
  const fixBtn = t => t.src === 'Nexus' && t.btn ? t.btn.replace(/href="#\//, 'href="index.html#/').replace('<a ', '<a target="_blank" rel="noopener" ') : (t.btn || '');

  VIEWS.mytasks = {
    mod: 'tasks', render() {
      const all = personTasks(ME.doer || '');
      const n = k => k === 'open' ? all.filter(t => t.status !== 'Completed' && t.status !== 'Excused').length : all.filter(t => t.status === k).length;
      const list = all.filter(t => MOB.f === 'open' ? (t.status !== 'Completed' && t.status !== 'Excused') : t.status === MOB.f)
        .sort((a, b) => { const o = { Delayed: 0, 'Not done': 1, Pending: 2, Upcoming: 3, Completed: 4, Excused: 5 }; return (o[a.status] - o[b.status]) || (b.delay || 0) - (a.delay || 0) || (a.planned || 0) - (b.planned || 0); });
      const chip = (v, l) => '<a class="mb-chip' + (MOB.f === v ? ' on' : '') + '" data-act="mb-f" data-v="' + v + '">' + l + ' ' + n(v) + '</a>';
      setMain('<div class="mb-chips">' + chip('open', 'Open') + chip('Delayed', 'Late') + chip('Pending', 'Today') + chip('Upcoming', 'Later') + chip('Completed', 'Done') + '</div>' +
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
      const sc = scoreOf(ME.doer, 30, true);
      const open = personTasks(ME.doer || '');
      const k = (l, v, c) => '<div class="mb-k"><b class="' + (c || '') + '">' + v + '</b><i>' + l + '</i></div>';
      setMain('<div class="mb-kpi">' + k('Score · 30 days', sc ? sc.score.toFixed(2) : '—', sc ? scoreCls(sc.score) : '') +
        k('Delayed', open.filter(t => t.status === 'Delayed').length, 'late-txt') + k('Today', open.filter(t => t.status === 'Pending').length) +
        k('Done · 30 days', open.filter(t => t.status === 'Completed').length, 'done-txt') + '</div>' +
        myScoreCard(ME.doer) + (typeof teamCard === 'function' ? teamCard(ME.doer) : ''));
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
