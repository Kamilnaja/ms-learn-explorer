/*
 * content.js — pasek „Dalej" na stronach Microsoft Learn.
 *
 * Stan strony:
 *   nav    — bieżący adres należy do zapisanego planu: pokazujemy postęp i następną lekcję
 *   offer  — strona kursu/ścieżki/modułu bez planu: proponujemy zbudowanie planu
 *   other  — strona spoza planu, ale mamy aktywny kurs: skrót powrotu do nauki
 */
(function () {
  'use strict';

  var M = window.MSLE;
  if (!M || !M.isTrainingUrl(location.href)) return;
  if (window.top !== window.self) return;          // nie w ramkach

  var HOST_ID = 'msle-host';
  var host, root, ui = { collapsed: false };
  var plan = null, prog = {}, index = -1, exact = false, state = 'none';
  var pageKind = '', busy = false, statsOpen = false;
  var lastTs = Date.now(), timer = null, clockBound = false;

  /* -------------------------------------------------------------- pomoc */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function locate(p, key) {
    var i, n = p.items.length;
    for (i = 0; i < n; i++) if (p.items[i].key === key) return { index: i, exact: true };
    for (i = 0; i < n; i++) if (p.items[i].moduleKey === key) return { index: i, exact: false };
    for (i = 0; i < n; i++) if (p.items[i].pathKey && p.items[i].pathKey === key) return { index: i, exact: false };
    if (p.key === key) return { index: 0, exact: false };
    return null;
  }

  // Pierwsza nieodwiedzona lekcja od `start`; jeśli brak — pierwsza nieodwiedzona w ogóle.
  function resumeFrom(start) {
    var i;
    for (i = Math.max(start, 0); i < plan.items.length; i++) if (!prog[plan.items[i].key]) return i;
    for (i = 0; i < plan.items.length; i++) if (!prog[plan.items[i].key]) return i;
    return -1;                                     // wszystko przerobione
  }

  // Na końcu listy nie zatrzymujemy się na ślepo — jeśli coś zostało pominięte,
  // „Dalej" prowadzi do pierwszej zaległej lekcji; dopiero potem kurs jest skończony.
  function nextIndex() {
    if (!plan) return -1;
    if (exact) return index + 1 < plan.items.length ? index + 1 : resumeFrom(0);
    var r = resumeFrom(index);
    return r >= 0 ? r : index;                     // kurs ukończony — wracamy na początek sekcji
  }

  function moduleHierarchy(uid, loc) {
    var u = M.ORIGIN + '/api/hierarchy/modules/' + encodeURIComponent(uid) + '?locale=' + encodeURIComponent(loc);
    return fetch(u, { credentials: 'omit', headers: { accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ------------------------------------------------------ opis „korzenia" */

  // Z czego zbudować plan dla bieżącej strony (Promise<root> albo null).
  function rootFromPage(info) {
    var base = { locale: info.locale, url: info.url, title: info.title, badge: M.badgeFor(info) };

    if (info.kind === 'course') {
      var kids = M.courseChildren();
      if (!kids.length) return Promise.resolve(null);
      base.kind = 'course';
      base.children = kids;
      return Promise.resolve(base);
    }
    if (info.kind === 'path' && info.uid) {
      base.kind = 'path';
      base.children = [{ uid: info.uid, type: 'path' }];
      return Promise.resolve(base);
    }
    if (info.kind === 'module' && info.uid) {
      base.kind = 'module';
      base.children = [{ uid: info.uid, type: 'module' }];
      return Promise.resolve(base);
    }
    if (info.kind === 'unit' && info.uid.indexOf('.') > 0) {
      // Z lekcji wychodzimy w górę: najchętniej do całej ścieżki, w ostateczności do modułu.
      var modUid = info.uid.replace(/\.[^.]+$/, '');
      return moduleHierarchy(modUid, info.locale).then(function (mod) {
        var parent = (mod.parents || []).filter(function (p) { return p.type === 'learningPath'; })[0];
        if (parent) {
          return {
            kind: 'path', locale: info.locale,
            url: M.absolute(parent.url, info.locale),
            title: parent.title, badge: M.badgeFor({ courseNumber: '' }, parent.title),
            children: [{ uid: parent.uid, type: 'path' }]
          };
        }
        return {
          kind: 'module', locale: info.locale,
          url: M.absolute(mod.url, info.locale),
          title: mod.title, badge: M.badgeFor({ courseNumber: '' }, mod.title),
          children: [{ uid: mod.uid, type: 'module' }]
        };
      }).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  /* ------------------------------------------------------------- widok */

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;margin:0;padding:0;font-family:"Segoe UI",system-ui,-apple-system,sans-serif}',
    '.wrap{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none}',
    '.bar{pointer-events:auto;display:flex;align-items:center;gap:14px;padding:10px 14px;',
    '  background:#0f1b2d;color:#e8f0fb;border-top:1px solid #24374f;',
    '  box-shadow:0 -6px 24px rgba(0,0,0,.35);font-size:13px;line-height:1.35}',
    '.prog{min-width:150px;flex:0 0 auto}',
    '.prog-top{display:flex;align-items:center;gap:8px;white-space:nowrap}',
    '.badge{background:#1b5fa8;color:#fff;border-radius:5px;padding:2px 7px;font-size:12px;font-weight:700;letter-spacing:.02em}',
    '.count{color:#a9bdd6;font-variant-numeric:tabular-nums}',
    '.pct{color:#4db8ff;font-weight:700;font-variant-numeric:tabular-nums}',
    '.track{height:5px;border-radius:3px;background:#24374f;margin-top:6px;overflow:hidden}',
    '.track i{display:block;height:100%;background:linear-gradient(90deg,#1b5fa8,#4db8ff);border-radius:3px;transition:width .3s ease}',
    '.next{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}',
    '.next-lbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.09em;color:#7f98b5}',
    '.next-title{font-size:14px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.next-sub{font-size:11.5px;color:#8fa7c2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.go{flex:0 0 auto;display:inline-flex;align-items:center;gap:9px;border:0;cursor:pointer;',
    '  background:#2f80ed;color:#fff;font-size:14px;font-weight:700;padding:10px 20px;border-radius:7px}',
    '.go:hover{background:#4a92f5}',
    '.go:disabled{background:#2a3c54;color:#8fa7c2;cursor:default}',
    '.go .arr{font-size:16px;line-height:1}',
    '.icon{flex:0 0 auto;border:0;background:transparent;color:#8fa7c2;cursor:pointer;font-size:15px;',
    '  width:30px;height:30px;border-radius:6px}',
    '.icon:hover{background:#1c2c42;color:#e8f0fb}',
    '.msg{flex:1 1 auto;color:#a9bdd6;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.err{color:#ff9a9a}',
    /* zwinięty pasek */
    '.pill{pointer-events:auto;position:absolute;right:14px;bottom:12px;display:inline-flex;align-items:center;gap:8px;',
    '  background:#0f1b2d;color:#e8f0fb;border:1px solid #24374f;border-radius:20px;padding:7px 13px;',
    '  font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.35)}',
    '.pill:hover{background:#1c2c42}',
    /* panel statystyk */
    '.panel{pointer-events:auto;background:#0b1524;color:#e8f0fb;border-top:1px solid #24374f;',
    '  max-height:46vh;overflow:auto;padding:14px 16px;font-size:12.5px}',
    '.panel h3{font-size:13px;margin-bottom:10px;color:#fff}',
    '.kpis{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}',
    '.kpi{background:#111f33;border:1px solid #21344c;border-radius:8px;padding:8px 12px;min-width:118px}',
    '.kpi b{display:block;font-size:16px;color:#4db8ff;font-variant-numeric:tabular-nums}',
    '.kpi span{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:#7f98b5}',
    '.mod{display:grid;grid-template-columns:1fr 62px 74px;gap:10px;align-items:center;padding:6px 0;border-top:1px solid #1a2a3e}',
    '.mod:first-of-type{border-top:0}',
    '.mod-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.mod-t small{display:block;color:#7f98b5;font-size:10.5px}',
    '.mod-n{color:#a9bdd6;text-align:right;font-variant-numeric:tabular-nums}',
    '.mod-b{height:5px;border-radius:3px;background:#24374f;overflow:hidden}',
    '.mod-b i{display:block;height:100%;background:#4db8ff}',
    '.acts{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}',
    '.acts button{background:#1c2c42;border:1px solid #2a3f5a;color:#cfe0f4;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px}',
    '.acts button:hover{background:#25394f}',
    '@media(max-width:760px){.next-sub,.next-lbl{display:none}.prog{min-width:120px}}'
  ].join('\n');

  function mount() {
    var old = document.getElementById(HOST_ID);
    if (old) old.remove();
    host = document.createElement('div');
    host.id = HOST_ID;
    root = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    var wrap = document.createElement('div');
    wrap.className = 'wrap';
    root.appendChild(wrap);
    (document.body || document.documentElement).appendChild(host);
    root.addEventListener('click', onClick);
    return wrap;
  }

  function wrapEl() { return root.querySelector('.wrap'); }

  function setBodyPad(px) {
    if (document.body) document.body.style.paddingBottom = px ? px + 'px' : '';
  }

  function render() {
    if (state === 'none' && !root) return;         // nic do pokazania — nie zaśmiecamy strony
    var wrap = root ? wrapEl() : mount();

    if (state === 'none') { wrap.innerHTML = ''; setBodyPad(0); return; }

    if (ui.collapsed) {
      var label = plan ? plan.badge + ' · ' + M.stats(plan, prog).pct + '%' : 'MS Learn';
      wrap.innerHTML = '<button class="pill" data-act="expand">' + esc(label) + ' <span>▴</span></button>';
      setBodyPad(0);
      return;
    }

    wrap.innerHTML = (statsOpen ? statsHtml() : '') + barHtml();
    setBodyPad(wrap.getBoundingClientRect().height + 8);
  }

  function barHtml() {
    if (state === 'offer') {
      var what = {
        course: ['Zbuduję plan całego kursu — potem wystarczy klikać „Dalej”.', 'Zacznij kurs'],
        path: ['Zbuduję plan tej ścieżki szkoleniowej.', 'Zacznij ścieżkę'],
        module: ['Zbuduję plan ścieżki, do której należy ten moduł.', 'Zacznij naukę'],
        unit: ['Zbuduję plan ścieżki, do której należy ta lekcja.', 'Zacznij naukę']
      }[pageKind] || ['Zbuduję plan nauki dla tej strony.', 'Zacznij naukę'];

      return '<div class="bar">' +
        '<div class="msg">' + esc(busy ? busy : what[0]) + '</div>' +
        '<button class="go" data-act="build"' + (busy ? ' disabled' : '') + '>' +
        (busy ? 'Buduję…' : esc(what[1]) + ' <span class="arr">→</span>') + '</button>' +
        '<button class="icon" data-act="collapse" title="Zwiń">✕</button>' +
        '</div>';
    }

    if (state === 'other') {
      var s0 = M.stats(plan, prog);
      return '<div class="bar">' +
        '<div class="prog"><div class="prog-top"><b class="badge">' + esc(plan.badge) + '</b>' +
        '<span class="pct">' + s0.pct + '%</span></div>' +
        '<div class="track"><i style="width:' + s0.pct + '%"></i></div></div>' +
        '<div class="msg">Ta strona nie należy do kursu — wróć do nauki.</div>' +
        '<button class="go" data-act="next">Wróć do kursu <span class="arr">→</span></button>' +
        '<button class="icon" data-act="collapse" title="Zwiń">✕</button>' +
        '</div>';
    }

    var s = M.stats(plan, prog);
    var n = nextIndex();
    var item = n >= 0 ? plan.items[n] : null;
    var pos = exact ? (index + 1) : s.done;

    var nextBlock;
    if (!item) {
      nextBlock = '<div class="next"><span class="next-lbl">Gotowe</span>' +
        '<span class="next-title">Kurs ukończony 🎉</span>' +
        '<span class="next-sub">' + esc(plan.title) + ' · ' + s.total + ' lekcji</span></div>' +
        '<button class="go" disabled>Koniec</button>';
    } else {
      // Skok wstecz zdarza się tylko wtedy, gdy na końcu kursu zostały zaległości.
      var back = exact && n <= index;
      nextBlock = '<div class="next"><span class="next-lbl">' +
        (back ? 'Zaległa lekcja' : 'Następna lekcja') + '</span>' +
        '<span class="next-title">' + esc(item.title) + '</span>' +
        '<span class="next-sub">' + esc(item.moduleTitle) + ' · ' + item.minutes + ' min' +
        (prog[item.key] ? ' · przerobione' : '') + '</span></div>' +
        '<button class="go" data-act="next" title="Alt + strzałka w prawo">Dalej <span class="arr">→</span></button>';
    }

    return '<div class="bar">' +
      '<button class="icon" data-act="stats" title="Statystyki">▤</button>' +
      '<div class="prog"><div class="prog-top">' +
      '<b class="badge">' + esc(plan.badge) + '</b>' +
      '<span class="count">' + pos + ' / ' + s.total + '</span>' +
      '<span class="pct">' + s.pct + '%</span></div>' +
      '<div class="track"><i style="width:' + s.pct + '%"></i></div></div>' +
      nextBlock +
      '<button class="icon" data-act="collapse" title="Zwiń">✕</button>' +
      '</div>';
  }

  function statsHtml() {
    if (!plan) return '';
    var s = M.stats(plan, prog);
    var rows = M.moduleBreakdown(plan, prog).map(function (m) {
      var pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
      return '<div class="mod">' +
        '<div class="mod-t">' + esc(m.title) + '<small>' + esc(m.path || plan.title) +
        (m.last ? ' · ostatnio ' + esc(M.ago(m.last)) : '') + '</small></div>' +
        '<div class="mod-n">' + m.done + '/' + m.total + '</div>' +
        '<div class="mod-b"><i style="width:' + pct + '%"></i></div>' +
        '</div>';
    }).join('');

    return '<div class="panel">' +
      '<h3>' + esc(plan.title) + '</h3>' +
      '<div class="kpis">' +
      '<div class="kpi"><b>' + s.pct + '%</b><span>ukończone</span></div>' +
      '<div class="kpi"><b>' + s.done + ' / ' + s.total + '</b><span>lekcje</span></div>' +
      '<div class="kpi"><b>' + esc(M.fmtDur(s.minutesDone)) + '</b><span>z ' + esc(M.fmtDur(s.minutesTotal)) + ' materiału</span></div>' +
      '<div class="kpi"><b>' + esc(M.fmtDur(s.seconds / 60)) + '</b><span>czas na stronach</span></div>' +
      '<div class="kpi"><b>' + esc(M.ago(s.last)) + '</b><span>ostatnia nauka</span></div>' +
      '</div>' + rows +
      '<div class="acts">' +
      '<button data-act="rebuild">Odśwież plan kursu</button>' +
      '<button data-act="reset">Wyzeruj postęp</button>' +
      '<button data-act="stats">Zamknij</button>' +
      '</div></div>';
  }

  /* ------------------------------------------------------------ zdarzenia */

  function onClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.preventDefault();
    var act = btn.getAttribute('data-act');

    if (act === 'next') return goNext();
    if (act === 'stats') { statsOpen = !statsOpen; return render(); }
    if (act === 'collapse') { ui.collapsed = true; M.saveUi(ui); return render(); }
    if (act === 'expand') { ui.collapsed = false; M.saveUi(ui); return render(); }
    if (act === 'build' || act === 'rebuild') return build();
    if (act === 'reset') {
      if (!plan) return;
      prog = {};
      M.resetProgress(plan.key).then(render);
      return;
    }
  }

  function goNext() {
    if (!plan) return;
    var n = nextIndex();
    if (n < 0) return;
    flushTime();
    location.href = plan.items[n].url;
  }

  function build() {
    if (busy) return;
    busy = 'Czytam strukturę kursu…';
    render();
    rootFromPage(M.pageInfo()).then(function (r) {
      if (!r) throw new Error('Nie rozpoznałem tej strony jako kursu.');
      return M.buildPlan(r, function (done, total, label) { busy = label; render(); })
        .then(function (p) {
          // Uzupełniamy tylko brakujące nazwy — klucz planu zawsze pochodzi z adresu strony,
          // inaczej ten sam kurs zapisałby się pod dwoma kluczami.
          if (!p.title) p.title = p.items[0].pathTitle || p.items[0].moduleTitle;
          if (!p.badge) p.badge = p.title.split(/\s+/).slice(0, 3).join(' ');
          return M.savePlan(p).then(function () {
            plan = p;
            return M.loadProgress(p.key);
          }).then(function (pr) {
            prog = pr;
            busy = false;
            var loc = locate(plan, M.keyOf(location.href));
            if (loc) { index = loc.index; exact = loc.exact; state = 'nav'; }
            else { index = 0; exact = false; state = 'nav'; }
            markVisit();
            render();
            if (!exact) goNext();               // ze strony spisu treści od razu w pierwszą lekcję
          });
        });
    }).catch(function (err) {
      busy = false;
      render();
      var msg = root.querySelector('.msg');
      if (msg) { msg.className = 'msg err'; msg.textContent = 'Błąd: ' + err.message; }
    });
  }

  /* -------------------------------------------------------- czas i wizyty */

  function markVisit() {
    if (!plan || !exact || index < 0) return;
    var key = plan.items[index].key;
    var e = prog[key] || (prog[key] = { n: 0, first: Date.now(), sec: 0 });
    e.n = (e.n || 0) + 1;
    e.last = Date.now();
    lastTs = Date.now();
    M.saveProgress(plan.key, prog);
  }

  function flushTime() {
    if (!plan || !exact || index < 0) return;
    var now = Date.now();
    var d = Math.round((now - lastTs) / 1000);
    lastTs = now;
    if (d <= 0 || d > 600) return;                 // pomijamy przerwy/uśpienie
    var e = prog[plan.items[index].key];
    if (!e) return;
    e.sec = (e.sec || 0) + d;
    e.last = now;
    M.saveProgress(plan.key, prog);
  }

  function startClock() {
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (document.visibilityState === 'visible') flushTime();
    }, 20000);

    if (clockBound) return;                        // nasłuchy podpinamy tylko raz
    clockBound = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') lastTs = Date.now();
      else flushTime();
    });
    window.addEventListener('pagehide', flushTime);
  }

  /* ------------------------------------------------------------- start */

  function pickPlan(ix, key) {
    var keys = Object.keys(ix.courses);
    if (ix.active) keys = [ix.active].concat(keys.filter(function (k) { return k !== ix.active; }));

    return keys.reduce(function (chain, ck) {
      return chain.then(function (found) {
        if (found) return found;
        return M.loadPlan(ck).then(function (p) {
          if (!p) return null;
          var loc = locate(p, key);
          return loc ? { plan: p, loc: loc } : null;
        });
      });
    }, Promise.resolve(null));
  }

  function init() {
    var info = M.pageInfo();
    var key = M.keyOf(location.href);
    pageKind = info.kind;

    Promise.all([M.loadIndex(), M.loadUi()]).then(function (res) {
      var ix = res[0];
      ui = res[1] || { collapsed: false };

      return pickPlan(ix, key).then(function (hit) {
        if (hit) {
          plan = hit.plan;
          index = hit.loc.index;
          exact = hit.loc.exact;
          state = 'nav';
          if (plan.key !== ix.active) M.setActive(plan.key);
          return M.loadProgress(plan.key).then(function (p) {
            prog = p;
            markVisit();
            startClock();
          });
        }

        // Brak planu dla tej strony — czy da się go tu zbudować?
        if (info.kind === 'course' || info.kind === 'path' || info.kind === 'module' || info.kind === 'unit') {
          state = 'offer';
          return;
        }
        if (ix.active) {
          return M.loadPlan(ix.active).then(function (p) {
            if (!p) return;
            plan = p;
            index = -1;
            exact = false;
            state = 'other';
            return M.loadProgress(p.key).then(function (pr) { prog = pr; });
          });
        }
      });
    }).then(render).catch(function (e) {
      console.warn('[MS Learn Explorer]', e);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.altKey && e.key === 'ArrowRight' && state === 'nav') {
      e.preventDefault();
      goNext();
    }
  });

  // Learn potrafi zmienić adres bez przeładowania — wtedy przeliczamy pasek.
  var lastHref = location.href;
  setInterval(function () {
    if (location.href === lastHref) return;
    lastHref = location.href;
    flushTime();
    plan = null; prog = {}; index = -1; exact = false; state = 'none'; statsOpen = false;
    init();
  }, 1000);

  init();
})();
