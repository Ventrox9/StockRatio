/* StockRatio – notification logic shared by the page and the service worker.
   Everything is evaluated on the device: portfolio, favourites and TP/SL never leave it.
   The push message from GitHub Actions only says "new data / trading day". */
(function (g) {
  'use strict';

  const LABELS = ['Kaufkandidat', 'Positiv', 'Neutral', 'Negativ', 'Meiden'];
  const CONS = ['Starker Kauf', 'Kaufen', 'Halten', 'Verkaufen', 'Starker Verkauf'];
  const DEFAULTS = {
    enabled: false, // master switch
    down: true,     // portfolio: strong downgrade
    up: false,      // portfolio: strong upgrade
    favs: true,     // also watch favourites
    tpsl: true,     // take profit / stop loss reached
    market: true,   // new strong buy signals outside the portfolio
    tradeday: true, // reminder on Wednesday & Friday
  };
  const SETTINGS_KEY = 'stockratio.notify.v1';
  const MINOR = { GBp: ['GBP', 0.01], GBX: ['GBP', 0.01], ZAc: ['ZAR', 0.01], ILA: ['ILS', 0.01] };

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const nf = (d) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const N0 = nf(0), N1 = nf(1), N2 = nf(2);
  const pct = (v, d = 0) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${(d ? N1 : N0).format(Math.abs(v * 100))} %`;
  const px = (v, cur) => `${(v >= 1000 ? N0 : N2).format(v)} ${cur || ''}`.trim();
  // link that opens exactly these stocks in the screener (best score first)
  const symsUrl = (syms) => `#syms=${syms.slice(0, 40).map(encodeURIComponent).join(',')}&s=score-`;
  const short = (s) => (s.n || s.s).replace(/,? (Inc\.?|Corporation|Corp\.?|Holdings?|N\.V\.|AG|SE|plc|Ltd\.?|Limited|S\.A\.)$/i, '');

  function consCat(rec, nA) {
    if (!isNum(rec) || !nA) return null;
    return rec <= 1.5 ? 0 : rec <= 2.5 ? 1 : rec <= 3.5 ? 2 : rec <= 4.5 ? 3 : 4;
  }
  // a stock that just became a strong buy candidate
  function strongBuy(s) {
    return s.type !== 'ETF' && isNum(s.score) && s.score >= 90 && isNum(s.rec) && s.rec <= 2.0
      && s.nA >= 5 && isNum(s.sVal) && s.sVal >= 40;
  }

  function snapshotOf(data, lvHits) {
    const map = {};
    for (const s of data.stocks || []) {
      map[s.s] = [LABELS.indexOf(s.label), isNum(s.rec) ? s.rec : null, s.nA || 0, isNum(s.score) ? s.score : null, strongBuy(s) ? 1 : 0];
    }
    return { generated: data.generated, map, lvHits: lvHits || {} };
  }

  function usdPerUnit(fx, cur) {
    const [major, mult] = MINOR[cur] || [cur, 1];
    return isNum(fx[major]) ? fx[major] * mult : null;
  }

  /* data: stocks.json · prev: last snapshot · ctx: { positions, favs, levels } · settings */
  function evaluate({ data, prev, ctx, settings }) {
    const S = Object.assign({}, DEFAULTS, settings || {});
    const bySym = {};
    (data.stocks || []).forEach((s) => { bySym[s.s] = s; });
    const held = new Set((ctx.positions || []).map((p) => p.s));
    const watched = new Set(held);
    if (S.favs) (ctx.favs || []).forEach((f) => watched.add(f));
    const lvHits = Object.assign({}, prev && prev.lvHits);
    const alerts = [];
    const isNew = !prev || prev.generated !== data.generated;

    // 1) rating changes of portfolio (+ favourites) – only when the data is new
    if (prev && isNew && (S.down || S.up)) {
      for (const sym of watched) {
        const s = bySym[sym], old = prev.map[sym];
        if (!s || !old) continue;
        const [oLab, oRec, oNA, oScore] = old;
        const nLab = LABELS.indexOf(s.label);
        const oCat = consCat(oRec, oNA), nCat = consCat(s.rec, s.nA);
        const labDelta = oLab >= 0 && nLab >= 0 ? nLab - oLab : 0;
        const catDelta = oCat !== null && nCat !== null ? nCat - oCat : 0;
        const parts = [];
        if (labDelta) parts.push(`${LABELS[oLab]} → ${LABELS[nLab]}`);
        if (isNum(oScore) && isNum(s.score) && Math.abs(s.score - oScore) >= 10) parts.push(`Score ${N0.format(oScore)} → ${N0.format(s.score)}`);
        if (catDelta) parts.push(`Analysten: ${CONS[oCat]} → ${CONS[nCat]}`);
        const where = held.has(sym) ? 'Portfolio' : 'Favorit';
        const down = labDelta >= 2 || (nLab === 4 && oLab >= 0 && oLab < 4) || catDelta >= 2 || (oCat !== null && oCat <= 1 && nCat !== null && nCat >= 3);
        const up = labDelta <= -2 || (nLab === 0 && oLab > 0) || catDelta <= -2;
        if (down && S.down) {
          alerts.push({ kind: 'down', sym, title: `⚠ ${short(s)}: Bewertung stark verschlechtert`, body: `${where} · ${parts.join(' · ')}`, url: symsUrl([sym]) });
        } else if (up && S.up) {
          alerts.push({ kind: 'up', sym, title: `↑ ${short(s)}: Bewertung deutlich verbessert`, body: `${where} · ${parts.join(' · ')}`, url: symsUrl([sym]) });
        }
      }
    }

    // 2) take profit / stop loss reached (once per generated level)
    if (S.tpsl) {
      for (const p of ctx.positions || []) {
        const s = bySym[p.s], L = (ctx.levels || {})[p.s];
        if (!s || !L || !isNum(s.px) || L.cur !== s.cur) continue;
        const key = L.at || '';
        let hit = null;
        if (s.px >= L.tp) hit = 'tp'; else if (s.px <= L.sl) hit = 'sl';
        if (hit && lvHits[p.s] !== `${key}|${hit}`) {
          lvHits[p.s] = `${key}|${hit}`;
          alerts.push(hit === 'tp'
            ? { kind: 'tp', sym: p.s, title: `🎯 ${short(s)}: Take Profit erreicht`, body: `Kurs ${px(s.px, s.cur)} ≥ Ziel ${px(L.tp, s.cur)} – Gewinnmitnahme prüfen.`, url: '#m=pf' }
            : { kind: 'sl', sym: p.s, title: `⛔ ${short(s)}: Stop Loss erreicht`, body: `Kurs ${px(s.px, s.cur)} ≤ Stop ${px(L.sl, s.cur)} – Position prüfen.`, url: '#m=pf' });
        }
      }
    }

    // 3) market: new strong buy signals outside the portfolio
    if (prev && isNew && S.market) {
      const fresh = (data.stocks || [])
        .filter((s) => strongBuy(s) && !held.has(s.s) && !(prev.map[s.s] && prev.map[s.s][4]))
        .sort((a, b) => b.score - a.score || (b.up || 0) - (a.up || 0));
      if (fresh.length) {
        const top = fresh.slice(0, 3).map((s) => `${short(s)} (Score ${N0.format(s.score)}${isNum(s.up) ? `, Potenzial ${pct(s.up)}` : ''})`);
        alerts.push({
          kind: 'market',
          sym: fresh[0].s,
          title: fresh.length === 1 ? `🚀 Neues starkes Kaufsignal: ${short(fresh[0])}` : `🚀 ${fresh.length} neue starke Kaufsignale`,
          body: top.join(' · ') + (fresh.length > 3 ? ` · und ${fresh.length - 3} weitere` : ''),
          url: symsUrl(fresh.map((s) => s.s)),
        });
      }
    }

    // group many rating alerts into one notification
    const rating = alerts.filter((a) => a.kind === 'down' || a.kind === 'up');
    let out = alerts;
    if (rating.length > 3) {
      out = alerts.filter((a) => a.kind !== 'down' && a.kind !== 'up');
      const downs = rating.filter((a) => a.kind === 'down').length;
      out.unshift({
        kind: 'down', sym: '',
        title: `⚠ ${rating.length} Bewertungsänderungen in Portfolio/Favoriten`,
        body: `${downs} Verschlechterungen, ${rating.length - downs} Verbesserungen: ` + rating.map((a) => a.title.replace(/^[^ ]+ /, '').split(':')[0]).join(', '),
        url: symsUrl(rating.map((a) => a.sym)),
      });
    }
    return { alerts: out, snapshot: snapshotOf(data, lvHits), isNew };
  }

  function tradedaySummary({ data, ctx, alerts, cur }) {
    const bySym = {};
    (data.stocks || []).forEach((s) => { bySym[s.s] = s; });
    const fx = data.fx || {};
    const target = cur === 'USD' ? 'USD' : 'EUR';
    let value = 0, day = 0;
    for (const p of ctx.positions || []) {
      const s = bySym[p.s];
      if (!s || !isNum(s.px)) continue;
      const from = usdPerUnit(fx, s.cur), to = usdPerUnit(fx, target);
      if (!from || !to) continue;
      const v = (s.px * from / to) * p.shares;
      value += v;
      if (isNum(s.d1)) day += v - v / (1 + s.d1);
    }
    const weekday = new Date().toLocaleDateString('de-DE', { weekday: 'long' });
    const money = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: target, maximumFractionDigits: 0 }).format(v);
    const parts = [];
    if (value) parts.push(`Portfolio ${money(value)} (${day >= 0 ? '+' : '−'}${money(Math.abs(day))} zuletzt)`);
    const warn = (alerts || []).filter((a) => a.kind === 'down' || a.kind === 'sl').length;
    parts.push(warn ? `${warn} Warnung${warn > 1 ? 'en' : ''}` : 'keine Warnungen');
    const held = new Set((ctx.positions || []).map((p) => p.s));
    const tops = (data.stocks || []).filter((s) => strongBuy(s) && !held.has(s.s)).sort((a, b) => b.score - a.score).slice(0, 3);
    if (tops.length) parts.push(`Top-Kaufsignale: ${tops.map(short).join(', ')}`);
    if (ctx.planCount) parts.push(`Kaufplan: ${ctx.planCount} Position${ctx.planCount > 1 ? 'en' : ''}`);
    return { kind: 'tradeday', sym: '', title: `📈 Handelstag ${weekday}`, body: parts.join(' · '), url: ctx.planCount ? '#m=pf&open=plan' : '#m=pf' };
  }

  /* show notes as system notifications (page or service worker registration) – at most 4 */
  async function display(reg, notes) {
    const list = notes.slice(0, 4);
    if (notes.length > 4) {
      const rest = notes.slice(3);
      const syms = rest.map((n) => n.sym).filter(Boolean);
      list[3] = { kind: 'more', sym: '', title: `StockRatio: ${rest.length} weitere Hinweise`, body: rest.map((n) => n.title).join(' · '), url: syms.length ? symsUrl(syms) : '#m=pf' };
    }
    for (const n of list) {
      await reg.showNotification(n.title, {
        body: n.body,
        icon: 'icons/icon-192.png',
        badge: 'icons/badge-96.png',
        tag: `sr-${n.kind || 'info'}-${n.sym || ''}`,
        renotify: true,
        data: { url: n.url || '' },
      });
    }
  }

  /* ---- tiny IndexedDB key/value store (works in page and service worker) */
  const idb = {
    _db: null,
    open() {
      if (this._db) return this._db;
      this._db = new Promise((resolve, reject) => {
        const req = indexedDB.open('stockratio', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return this._db;
    },
    async get(key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const r = db.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    },
    async set(key, value) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };

  async function loadContext() {
    const [pf, favs, levels, plan, settings] = await Promise.all([
      idb.get('stockratio.portfolio.v1'), idb.get('stockratio.favs.v2'), idb.get('stockratio.pf.levels.v1'),
      idb.get('stockratio.plan.v1'), idb.get(SETTINGS_KEY),
    ]);
    return {
      ctx: {
        positions: (pf && pf.positions) || [],
        cur: (pf && pf.cur) || 'EUR',
        favs: Array.isArray(favs) ? favs : [],
        levels: (levels && levels.items) || {},
        planCount: (plan && Array.isArray(plan.items)) ? plan.items.length : 0,
      },
      settings: Object.assign({}, DEFAULTS, settings || {}),
    };
  }

  async function addHistory(notes, via) {
    if (!notes.length) return;
    const hist = (await idb.get('notify.history')) || [];
    const at = new Date().toISOString();
    notes.slice().reverse().forEach((n) => hist.unshift({ at, title: n.title, body: n.body, url: n.url, via }));
    await idb.set('notify.history', hist.slice(0, 30));
  }

  /* Full check: new data vs. last snapshot -> notifications to show. Shared by page & worker. */
  async function check(data, { type = 'update', via = 'push' } = {}) {
    const { ctx, settings } = await loadContext();
    const prev = await idb.get('notify.snapshot');
    const { alerts, snapshot, isNew } = evaluate({ data, prev, ctx, settings });
    if (isNew || JSON.stringify(snapshot.lvHits) !== JSON.stringify(prev && prev.lvHits)) await idb.set('notify.snapshot', snapshot);
    let notes = settings.enabled ? alerts : [];
    if (type === 'tradeday' && settings.enabled && settings.tradeday) notes = [tradedaySummary({ data, ctx, alerts, cur: ctx.cur }), ...notes];
    if (type === 'test') notes = [{ kind: 'test', title: '✅ StockRatio: Push funktioniert', body: 'Diese Test-Nachricht kam über GitHub Actions auf dein Gerät.', url: '#m=pf' }, ...notes];
    await addHistory(notes, via);
    return { notes, baseline: !prev };
  }

  g.SRNotify = { DEFAULTS, SETTINGS_KEY, LABELS, evaluate, tradedaySummary, snapshotOf, strongBuy, symsUrl, display, idb, loadContext, addHistory, check };
})(self);
