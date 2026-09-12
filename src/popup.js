/* popup.js — lista zapisanych kursów i szybkie wznowienie nauki. */
(function () {
  'use strict';

  var M = window.MSLE;
  var ext = M.ext;
  var list = document.getElementById('list');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function resumeUrl(plan, prog) {
    for (var i = 0; i < plan.items.length; i++) {
      if (!prog[plan.items[i].key]) return plan.items[i].url;
    }
    return plan.items[0].url;
  }

  function open(url) {
    ext.tabs.create({ url: url });
    window.close();
  }

  M.loadIndex().then(function (ix) {
    var keys = Object.keys(ix.courses);
    if (!keys.length) {
      list.innerHTML = '<p class="empty">Nie masz jeszcze żadnego kursu.<br><br>' +
        'Wejdź na stronę kursu, np. ' +
        '<a href="https://learn.microsoft.com/en-us/training/courses/dp-900t00" target="_blank">DP-900</a>, ' +
        'i kliknij <b>Zacznij kurs</b> na pasku na dole strony.</p>';
      return;
    }
    if (ix.active) keys = [ix.active].concat(keys.filter(function (k) { return k !== ix.active; }));

    return keys.reduce(function (chain, k) {
      return chain.then(function () {
        return Promise.all([M.loadPlan(k), M.loadProgress(k)]).then(function (r) {
          var plan = r[0], prog = r[1];
          if (!plan) return;
          var s = M.stats(plan, prog);

          var card = document.createElement('div');
          card.className = 'card' + (k === ix.active ? ' active' : '');
          card.innerHTML =
            '<div class="top"><span class="badge">' + esc(plan.badge) + '</span>' +
            '<span class="pct">' + s.pct + '%</span></div>' +
            '<div class="title">' + esc(plan.title) + '</div>' +
            '<div class="track"><i style="width:' + s.pct + '%"></i></div>' +
            '<div class="meta"><span>' + s.done + ' / ' + s.total + ' lekcji</span>' +
            '<span>' + esc(M.fmtDur(s.seconds / 60)) + ' nauki</span>' +
            '<span>ostatnio ' + esc(M.ago(s.last)) + '</span></div>' +
            '<div class="row">' +
            '<button data-go="resume">Kontynuuj</button>' +
            '<button class="ghost" data-go="start">Spis treści</button>' +
            '<button class="ghost" data-go="drop" title="Usuń kurs i jego statystyki">Usuń</button>' +
            '</div>';

          card.addEventListener('click', function (e) {
            var b = e.target.closest('[data-go]');
            if (!b) return;
            var what = b.getAttribute('data-go');
            if (what === 'resume') { M.setActive(k).then(function () { open(resumeUrl(plan, prog)); }); }
            else if (what === 'start') { M.setActive(k).then(function () { open(plan.url); }); }
            else if (what === 'drop') { M.forgetCourse(k).then(function () { card.remove(); }); }
          });

          list.appendChild(card);
        });
      });
    }, Promise.resolve());
  }).catch(function (e) {
    list.innerHTML = '<p class="empty">Błąd: ' + esc(e.message) + '</p>';
  });
})();
