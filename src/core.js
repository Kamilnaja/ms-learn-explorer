/*
 * core.js — wspólna warstwa danych dla MS Learn Explorer.
 *
 * Plan kursu budujemy z publicznego API hierarchii Microsoft Learn:
 *   /api/hierarchy/paths/<uid>?locale=xx-yy    -> lista modułów ścieżki
 *   /api/hierarchy/modules/<uid>?locale=xx-yy  -> lista lekcji modułu (z URL-ami)
 *
 * Strony kursu/ścieżki/modułu renderują swoje listy dopiero po stronie klienta,
 * więc scrapowanie DOM-u jest zawodne — API zwraca komplet i we właściwej kolejności.
 */
;(function (global) {
  'use strict';

  var ext = typeof browser !== 'undefined' ? browser : chrome;
  var ORIGIN = 'https://learn.microsoft.com';

  var K = {
    index: 'msle.index',
    ui: 'msle.ui',
    plan: function (k) { return 'msle.plan.' + k; },
    prog: function (k) { return 'msle.prog.' + k; }
  };

  /* ---------------------------------------------------------------- URL-e */

  // '/en-us/training/...' -> '/training/...'
  function stripLocale(pathname) {
    return pathname.replace(/^\/[a-z]{2}-[a-z]{2,4}\//i, '/');
  }

  // Klucz porównawczy: bez locale, bez query, bez końcowego ukośnika, lowercase.
  function keyOf(u) {
    try {
      var base = global.location ? global.location.href : ORIGIN;
      var url = new URL(u, base);
      var p = stripLocale(url.pathname).toLowerCase().replace(/\/+$/, '');
      return p || '/';
    } catch (e) {
      return '';
    }
  }

  // API oddaje ścieżki bez locale ('/training/modules/x/1-intro/') — dokładamy je.
  function absolute(path, locale) {
    if (!path) return '';
    var p = /^https?:/i.test(path) ? new URL(path).pathname : path;
    p = stripLocale(p).replace(/\/+$/, '');
    return ORIGIN + '/' + (locale || 'en-us') + p;
  }

  function isTrainingUrl(u) {
    try {
      return /^\/([a-z]{2}-[a-z]{2,4}\/)?training\//i.test(new URL(u, ORIGIN).pathname);
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------- odczyt strony */

  function meta(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? el.getAttribute('content') || '' : '';
  }

  function pageInfo() {
    var m = location.pathname.match(/^\/([a-z]{2}-[a-z]{2,4})\//i);
    var og = document.querySelector('meta[property="og:title"]');
    return {
      kind: meta('page_kind'),                       // course | path | module | unit
      uid: meta('uid'),
      locale: meta('locale') || (m ? m[1] : 'en-us'),
      courseNumber: meta('courseNumber'),
      title: (og && og.getAttribute('content')) || document.title,
      url: location.origin + location.pathname
    };
  }

  // Krótka etykieta na przycisk: 'DP-900T00' -> 'DP-900', inaczej pierwsze słowa tytułu.
  function badgeFor(info, fallbackTitle) {
    if (info.courseNumber) return info.courseNumber.replace(/T\d+(-[A-Z])?$/i, '');
    var t = (fallbackTitle || info.title || 'Learn').replace(/\s*[|–-]\s*Training.*$/i, '').trim();
    var words = t.split(/\s+/).slice(0, 3).join(' ');
    return words.length > 28 ? words.slice(0, 27) + '…' : words;
  }

  // Dzieci kursu. meta[name=learn_item] jest uporządkowane i wolne od sekcji
  // „powiązane", więc jest źródłem głównym; DOM służy tylko do podpowiedzi typu.
  function courseChildren() {
    var typeByUid = {};
    document.querySelectorAll('[data-learn-type]').forEach(function (list) {
      var t = list.getAttribute('data-learn-type');
      list.querySelectorAll('[data-learn-uid]').forEach(function (el) {
        typeByUid[el.getAttribute('data-learn-uid')] = t;
      });
    });

    var out = [], seen = {};
    function push(uid) {
      if (!uid || seen[uid]) return;
      seen[uid] = 1;
      out.push({ uid: uid, type: typeByUid[uid] || '' });
    }
    document.querySelectorAll('meta[name="learn_item"]').forEach(function (m) {
      push(m.getAttribute('content'));
    });
    if (!out.length) {
      document.querySelectorAll('[data-learn-uid]').forEach(function (el) {
        push(el.getAttribute('data-learn-uid'));
      });
    }
    return out;
  }

  /* ------------------------------------------------------------ API Learn */

  function getJson(url) {
    return fetch(url, { credentials: 'omit', headers: { accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' – ' + url);
      return r.json();
    });
  }

  function hierPath(uid, loc) {
    return ORIGIN + '/api/hierarchy/paths/' + encodeURIComponent(uid) + '?locale=' + encodeURIComponent(loc);
  }
  function hierModule(uid, loc) {
    return ORIGIN + '/api/hierarchy/modules/' + encodeURIComponent(uid) + '?locale=' + encodeURIComponent(loc);
  }

  // Typ dziecka kursu bywa nieznany — próbujemy ścieżkę, potem moduł.
  function resolveNode(uid, type, loc) {
    if (type === 'module') {
      return getJson(hierModule(uid, loc)).then(function (d) { return { type: 'module', data: d }; });
    }
    if (type === 'path' || type === 'learningPath') {
      return getJson(hierPath(uid, loc)).then(function (d) { return { type: 'path', data: d }; });
    }
    return getJson(hierPath(uid, loc))
      .then(function (d) { return { type: 'path', data: d }; })
      .catch(function () {
        return getJson(hierModule(uid, loc)).then(function (d) { return { type: 'module', data: d }; });
      });
  }

  // Ograniczona równoległość — kolejność wyniku zachowana.
  function mapPool(list, limit, fn) {
    var out = new Array(list.length), i = 0, workers = [];
    function run() {
      if (i >= list.length) return Promise.resolve();
      var k = i++;
      return Promise.resolve(fn(list[k], k)).then(function (v) { out[k] = v; return run(); });
    }
    for (var w = 0; w < Math.min(limit, list.length); w++) workers.push(run());
    return Promise.all(workers).then(function () { return out; });
  }

  /**
   * Buduje liniową listę lekcji.
   * root: { kind, title, badge, url, locale, children:[{uid,type}] }
   * onProgress(done, total, label)
   */
  function buildPlan(root, onProgress) {
    var loc = root.locale;
    var report = onProgress || function () {};

    report(0, 0, 'Czytam strukturę kursu…');

    return mapPool(root.children, 3, function (c) { return resolveNode(c.uid, c.type, loc); })
      .then(function (nodes) {
        var mods = [];
        nodes.forEach(function (n) {
          if (n.type === 'path') {
            (n.data.modules || []).forEach(function (m) {
              mods.push({
                uid: m.uid, pre: null,
                pathUid: n.data.uid, pathTitle: n.data.title, pathUrl: absolute(n.data.url, loc)
              });
            });
          } else {
            mods.push({ uid: n.data.uid, pre: n.data, pathUid: '', pathTitle: '', pathUrl: '' });
          }
        });
        if (!mods.length) throw new Error('Nie znalazłem modułów w tym kursie.');

        var done = 0;
        return mapPool(mods, 4, function (m) {
          var p = m.pre ? Promise.resolve(m.pre) : getJson(hierModule(m.uid, loc));
          return p.then(function (d) {
            done++;
            report(done, mods.length, 'Pobieram lekcje… ' + done + '/' + mods.length);
            return { meta: m, data: d };
          });
        });
      })
      .then(function (details) {
        var items = [], minutes = 0;
        details.forEach(function (d) {
          var modUrl = absolute(d.data.url, loc);
          (d.data.units || []).forEach(function (u) {
            var url = absolute(u.url, loc);
            minutes += u.durationInMinutes || 0;
            items.push({
              key: keyOf(url),
              url: url,
              title: u.title,
              minutes: u.durationInMinutes || 0,
              uid: u.uid,
              moduleUid: d.data.uid,
              moduleTitle: d.data.title,
              moduleUrl: modUrl,
              moduleKey: keyOf(modUrl),
              pathUid: d.meta.pathUid,
              pathTitle: d.meta.pathTitle,
              pathKey: d.meta.pathUrl ? keyOf(d.meta.pathUrl) : ''
            });
          });
        });
        if (!items.length) throw new Error('Kurs nie zawiera żadnych lekcji.');

        return {
          key: keyOf(root.url),
          kind: root.kind,
          title: root.title,
          badge: root.badge,
          url: root.url,
          locale: loc,
          builtAt: Date.now(),
          minutes: minutes,
          items: items
        };
      });
  }

  /* ------------------------------------------------------------- storage */

  function get(k, dflt) {
    return ext.storage.local.get(k).then(function (r) { return r[k] === undefined ? dflt : r[k]; });
  }
  function set(k, v) { var o = {}; o[k] = v; return ext.storage.local.set(o); }

  function loadIndex() { return get(K.index, { courses: {}, active: '' }); }
  function saveIndex(ix) { return set(K.index, ix); }

  function loadPlan(courseKey) { return courseKey ? get(K.plan(courseKey), null) : Promise.resolve(null); }
  function loadProgress(courseKey) { return get(K.prog(courseKey), {}); }
  function saveProgress(courseKey, prog) { return set(K.prog(courseKey), prog); }

  function savePlan(plan) {
    return set(K.plan(plan.key), plan).then(loadIndex).then(function (ix) {
      ix.courses[plan.key] = {
        key: plan.key, title: plan.title, badge: plan.badge, url: plan.url,
        total: plan.items.length, minutes: plan.minutes, builtAt: plan.builtAt
      };
      ix.active = plan.key;
      return saveIndex(ix);
    });
  }

  function setActive(courseKey) {
    return loadIndex().then(function (ix) { ix.active = courseKey; return saveIndex(ix); });
  }

  function forgetCourse(courseKey) {
    return ext.storage.local.remove([K.plan(courseKey), K.prog(courseKey)]).then(loadIndex).then(function (ix) {
      delete ix.courses[courseKey];
      if (ix.active === courseKey) ix.active = Object.keys(ix.courses)[0] || '';
      return saveIndex(ix);
    });
  }

  function resetProgress(courseKey) { return saveProgress(courseKey, {}); }

  function loadUi() { return get(K.ui, { collapsed: false }); }
  function saveUi(ui) { return set(K.ui, ui); }

  /* ------------------------------------------------------------ statystyki */

  function stats(plan, prog) {
    var done = 0, minutesDone = 0, seconds = 0, last = 0;
    plan.items.forEach(function (it) {
      var p = prog[it.key];
      if (!p) return;
      done++;
      minutesDone += it.minutes;
      seconds += p.sec || 0;
      if ((p.last || 0) > last) last = p.last;
    });
    var total = plan.items.length;
    return {
      done: done,
      total: total,
      pct: total ? Math.round((done / total) * 100) : 0,
      minutesDone: minutesDone,
      minutesTotal: plan.minutes,
      seconds: seconds,
      last: last
    };
  }

  // Postęp w rozbiciu na moduły — do panelu statystyk.
  function moduleBreakdown(plan, prog) {
    var order = [], by = {};
    plan.items.forEach(function (it) {
      if (!by[it.moduleUid]) {
        by[it.moduleUid] = {
          title: it.moduleTitle, path: it.pathTitle, url: it.moduleUrl,
          done: 0, total: 0, last: 0
        };
        order.push(it.moduleUid);
      }
      var m = by[it.moduleUid];
      m.total++;
      var p = prog[it.key];
      if (p) {
        m.done++;
        if ((p.last || 0) > m.last) m.last = p.last;
      }
    });
    return order.map(function (uid) { return by[uid]; });
  }

  /* ------------------------------------------------------------- formaty */

  function fmtDur(minutes) {
    minutes = Math.round(minutes || 0);
    var h = Math.floor(minutes / 60), m = minutes % 60;
    if (h && m) return h + ' h ' + m + ' min';
    if (h) return h + ' h';
    return m + ' min';
  }

  function ago(ts) {
    if (!ts) return '—';
    var rtf = new Intl.RelativeTimeFormat('pl', { numeric: 'auto' });
    var s = Math.round((ts - Date.now()) / 1000);
    var units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (var i = 0; i < units.length; i++) {
      if (Math.abs(s) >= units[i][1]) return rtf.format(Math.round(s / units[i][1]), units[i][0]);
    }
    return rtf.format(s, 'second');
  }

  global.MSLE = {
    ext: ext,
    ORIGIN: ORIGIN,
    keyOf: keyOf,
    absolute: absolute,
    isTrainingUrl: isTrainingUrl,
    pageInfo: pageInfo,
    badgeFor: badgeFor,
    courseChildren: courseChildren,
    buildPlan: buildPlan,
    loadIndex: loadIndex,
    loadPlan: loadPlan,
    savePlan: savePlan,
    loadProgress: loadProgress,
    saveProgress: saveProgress,
    setActive: setActive,
    forgetCourse: forgetCourse,
    resetProgress: resetProgress,
    loadUi: loadUi,
    saveUi: saveUi,
    stats: stats,
    moduleBreakdown: moduleBreakdown,
    fmtDur: fmtDur,
    ago: ago
  };
})(typeof window !== 'undefined' ? window : self);
