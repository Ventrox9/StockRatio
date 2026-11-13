'use strict';

/* ======================================================================
   StockRatio – client-side screener
   Loads data/stocks.json (built daily by GitHub Actions) and renders a
   sortable / filterable table with a detail view per stock.
   ====================================================================== */

const DATA_URL = 'data/stocks.json';
const PAGE_SIZE = 50; // desktop table rows per page
const CARD_STEP = 30; // mobile cards per "Mehr anzeigen"
const MOBILE = window.matchMedia('(max-width: 760px)');
const isMobile = () => MOBILE.matches;

const SECTORS_DE = {
  'Technology': 'Technologie',
  'Financial Services': 'Finanzen',
  'Healthcare': 'Gesundheit',
  'Consumer Cyclical': 'Zyklischer Konsum',
  'Industrials': 'Industrie',
  'Communication Services': 'Kommunikation',
  'Consumer Defensive': 'Basiskonsum',
  'Energy': 'Energie',
  'Basic Materials': 'Rohstoffe',
  'Real Estate': 'Immobilien',
  'Utilities': 'Versorger',
};

const COUNTRIES = { // English name -> [German name, ISO code]
  'United States': ['USA', 'US'], 'Japan': ['Japan', 'JP'], 'Canada': ['Kanada', 'CA'],
  'United Kingdom': ['Großbritannien', 'GB'], 'Germany': ['Deutschland', 'DE'], 'France': ['Frankreich', 'FR'],
  'Switzerland': ['Schweiz', 'CH'], 'Australia': ['Australien', 'AU'], 'Sweden': ['Schweden', 'SE'],
  'Netherlands': ['Niederlande', 'NL'], 'Hong Kong': ['Hongkong', 'HK'], 'Italy': ['Italien', 'IT'],
  'Spain': ['Spanien', 'ES'], 'Ireland': ['Irland', 'IE'], 'Singapore': ['Singapur', 'SG'],
  'Israel': ['Israel', 'IL'], 'Denmark': ['Dänemark', 'DK'], 'Finland': ['Finnland', 'FI'],
  'Norway': ['Norwegen', 'NO'], 'Belgium': ['Belgien', 'BE'], 'Austria': ['Österreich', 'AT'],
  'New Zealand': ['Neuseeland', 'NZ'], 'Luxembourg': ['Luxemburg', 'LU'], 'Bermuda': ['Bermuda', 'BM'],
  'Portugal': ['Portugal', 'PT'], 'China': ['China', 'CN'], 'Cayman Islands': ['Kaimaninseln', 'KY'],
  'Taiwan': ['Taiwan', 'TW'], 'Uruguay': ['Uruguay', 'UY'], 'Brazil': ['Brasilien', 'BR'],
  'Jersey': ['Jersey', 'JE'], 'Guernsey': ['Guernsey', 'GG'], 'Isle of Man': ['Isle of Man', 'IM'],
  'Mexico': ['Mexiko', 'MX'], 'South Korea': ['Südkorea', 'KR'], 'India': ['Indien', 'IN'],
  'Argentina': ['Argentinien', 'AR'], 'Greece': ['Griechenland', 'GR'], 'Poland': ['Polen', 'PL'],
  'South Africa': ['Südafrika', 'ZA'], 'Macau': ['Macau', 'MO'], 'Monaco': ['Monaco', 'MC'],
};

const EUROPE = ['United Kingdom', 'Germany', 'France', 'Switzerland', 'Sweden', 'Netherlands', 'Italy', 'Spain',
  'Ireland', 'Denmark', 'Finland', 'Norway', 'Belgium', 'Austria', 'Luxembourg', 'Portugal', 'Jersey', 'Guernsey',
  'Isle of Man', 'Greece', 'Poland', 'Monaco'];
const APAC = ['Japan', 'Australia', 'Hong Kong', 'Singapore', 'New Zealand', 'China', 'Taiwan', 'South Korea', 'India', 'Macau'];
const DACH = ['Germany', 'Austria', 'Switzerland'];
const REGIONS = [
  ['R:US', 'USA', c => c === 'United States'],
  ['R:EU', 'Europa', c => EUROPE.includes(c)],
  ['R:DACH', 'DACH (DE/AT/CH)', c => DACH.includes(c)],
  ['R:APAC', 'Asien / Pazifik', c => APAC.includes(c)],
  ['R:XUS', 'Alles außer USA', c => c !== 'United States'],
];

const LABEL_ORDER = ['Kaufkandidat', 'Positiv', 'Neutral', 'Negativ', 'Meiden'];
const PILLARS = [
  ['sVal', 'Bewertung', 'val'],
  ['sQual', 'Qualität', 'qual'],
  ['sGrow', 'Wachstum', 'grow'],
  ['sAna', 'Analysten', 'ana'],
  ['sMom', 'Momentum', 'mom'],
];

/* ---------------------------------------------------------------- formatting */

const nf = (d) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const NF = [nf(0), nf(1), nf(2)];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NA = '<span class="na">–</span>';

function num(v, d = 1) { return isNum(v) ? NF[d].format(v) : NA; }
function pct(v, d = 1, signed = false, colored = false) {
  if (!isNum(v)) return NA;
  const txt = (signed && v > 0 ? '+' : '') + NF[d].format(v * 100) + ' %';
  if (!colored) return txt;
  return `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${txt}</span>`;
}
function mcapFmt(bn) {
  if (!isNum(bn)) return NA;
  if (bn >= 1000) return NF[2].format(bn / 1000) + ' Bio. $';
  if (bn >= 10) return NF[0].format(bn) + ' Mrd. $';
  return NF[1].format(bn) + ' Mrd. $';
}
function priceFmt(s) {
  if (!isNum(s.px)) return NA;
  const d = s.px >= 1000 ? 0 : 2;
  let cur = s.cur || '';
  if (cur === 'GBp') cur = 'GBp';
  return `${NF[d].format(s.px)} <span class="tk">${esc(cur)}</span>`;
}
const sectorDe = (s) => SECTORS_DE[s] || s || '–';
const countryDe = (c) => (COUNTRIES[c] || [c])[0] || '–';
const countryIso = (c) => (COUNTRIES[c] || [null, ''])[1];

function consensus(rec, nA) {
  if (!isNum(rec) || !nA) return null;
  if (rec <= 1.5) return ['Starker Kauf', 'buy'];
  if (rec <= 2.5) return ['Kaufen', 'buy'];
  if (rec <= 3.5) return ['Halten', 'hold'];
  if (rec <= 4.5) return ['Verkaufen', 'sell'];
  return ['Starker Verkauf', 'sell'];
}
function buyShare(s) {
  if (!s.dist) return null;
  const total = s.dist.reduce((a, b) => a + b, 0);
  return total ? (s.dist[0] + s.dist[1]) / total : null;
}
function valuationBadge(s) {
  if (!isNum(s.sVal)) return null;
  if (s.sVal >= 70) return ['günstig', 'b-cheap'];
  if (s.sVal <= 25) return ['teuer', 'b-exp'];
  return ['fair', 'b-fair'];
}

/* ---------------------------------------------------------------- state */

const DEFAULT_FILTERS = {
  index: '', region: '', sector: '', label: '', val: '', ana: '',
  peMax: '', fpeMax: '', pegMax: '', scoreMin: '', mcapMin: '', divMin: '', upMin: '',
  noLoss: false, minAnalysts: false,
};

const state = {
  q: '',
  syms: [], // exact selection, e.g. from a notification ("#syms=AAPL,MSFT")
  preset: '',
  view: 'overview',
  sort: { key: 'mcap', dir: -1 },
  page: 1,
  shown: CARD_STEP,
  mode: 'screener',
  f: { ...DEFAULT_FILTERS },
};

let DATA = null;
let STOCKS = [];
let MED = {};
let filtered = [];

const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
    // mirror to IndexedDB so the service worker can evaluate notifications in the background
    if (self.SRNotify && key.startsWith('stockratio.')) SRNotify.idb.set(key, JSON.parse(JSON.stringify(value))).catch(() => {});
  },
};
// Favourites: v2 is seeded once from watchlist.txt (stocks flagged "WL"),
// afterwards it is fully controlled by the star buttons.
const FAV_KEY = 'stockratio.favs.v2';
const storedFavs = store.get(FAV_KEY, null);
const favs = new Set(Array.isArray(storedFavs) ? storedFavs : []);
const favsSeeded = Array.isArray(storedFavs);

// Portfolio: [{ s: symbol, shares }] + display currency
const PF_KEY = 'stockratio.portfolio.v1';
const PF = Object.assign({ cur: 'EUR', positions: [] }, store.get(PF_KEY, {}));
const savePF = () => store.set(PF_KEY, PF);

// Kaufplan (temporary buy list): items [{ s, status: open|bought|skipped, amt?: frozen EUR, inv?: invested EUR }]
const PLAN_KEY = 'stockratio.plan.v1';
const PLAN = Object.assign({ budget: null, mode: 'smart', frozen: false, items: [] }, store.get(PLAN_KEY, {}));
if (!Array.isArray(PLAN.items)) PLAN.items = [];
const savePlan = () => store.set(PLAN_KEY, PLAN);

// Take-profit / stop-loss levels for portfolio positions (stored separately, never touches PF)
const LV_KEY = 'stockratio.pf.levels.v1';
const LEVELS = Object.assign({ items: {} }, store.get(LV_KEY, {}));
if (!LEVELS.items || typeof LEVELS.items !== 'object') LEVELS.items = {};
const saveLevels = () => store.set(LV_KEY, LEVELS);

// Broker limits for take-profit orders. Revolut rejects sell limits above 150 % of the current price;
// we stay at +45 % because our prices are end-of-day and can move before the order is placed.
const BROKERS = {
  revolut: { label: 'Revolut (TP max. +45 %)', hard: 0.5, cap: 0.45, name: 'Revolut' },
  none: { label: 'Ohne Broker-Grenze', hard: null, cap: null, name: '' },
};
const SETTINGS_KEY = 'stockratio.settings.v1';
const SETTINGS = Object.assign({ broker: 'revolut' }, store.get(SETTINGS_KEY, {}));
if (!BROKERS[SETTINGS.broker]) SETTINGS.broker = 'revolut';
const broker = () => BROKERS[SETTINGS.broker];
const brokerSelect = () => `<label class="broker-sel"><span>Broker-Grenze</span><select data-broker>
  ${Object.entries(BROKERS).map(([k, b]) => `<option value="${k}" ${SETTINGS.broker === k ? 'selected' : ''}>${b.label}</option>`).join('')}
</select></label>`;
const inPlan = (sym) => PLAN.items.some((i) => i.s === sym);
const planBtn = (s, long = false) => {
  const on = inPlan(s.s);
  return `<button class="${long ? 'btn ghost plan-add-long' : 'plus'} ${on ? 'on' : ''}" data-plan="${esc(s.s)}" ${long ? 'data-long="1"' : ''}
    aria-label="${on ? 'Aus dem Kaufplan entfernen' : 'Zum Kaufplan hinzufügen'}" title="${on ? 'Im Kaufplan' : 'Zum Kaufplan'}">${planBtnLabel(on, long)}</button>`;
};
const planBtnLabel = (on, long) => (long ? (on ? '✓ Im Kaufplan' : '+ Zum Kaufplan') : (on ? '✓' : '+'));
let BYSYM = {};

/* ---------------------------------------------------------------- themes & logos */

const THEMES = [
  ['auto', 'Automatisch', 'Hell oder Dunkel – wie dein Gerät'],
  ['dark', 'Dunkel', 'Ruhiges Anthrazit, augenschonend'],
  ['light', 'Hell', 'Klar und kontrastreich'],
  ['sand', 'Beige', 'Warmes Papier, weich für die Augen'],
];
const THEME_KEY = 'stockratio.theme';
let theme = store.get(THEME_KEY, 'auto');
if (!THEMES.some((t) => t[0] === theme)) theme = 'auto';
const DARK_MQ = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(t = theme) {
  theme = t;
  const root = document.documentElement;
  if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
  // status bar / browser chrome follows the header colour
  const meta = document.getElementById('themeColor');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--surface').trim() || '#161a21';
  document.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themePick === theme)));
}
function setTheme(t) {
  store.set(THEME_KEY, t);
  applyTheme(t);
}
const themeOptionsHtml = () => THEMES.map(([id, label, desc]) =>
  `<button role="menuitemradio" class="theme-opt" data-theme-pick="${id}" aria-checked="${theme === id}">
    <span class="swatch sw-${id}" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="theme-txt"><b>${label}</b><small>${desc}</small></span>
    <span class="theme-check" aria-hidden="true">✓</span></button>`).join('');

// Company logos: financialmodelingprep.com (by ticker, ~99 % coverage) -> favicon of the company website
// -> coloured monogram. Failed URLs are remembered so re-renders don't retry them.
const LOGO_FAIL = new Set();
const logosOn = () => SETTINGS.logos !== false;
function domainOf(web) {
  try { return new URL(web).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function logoSrc(s) {
  const a = `https://financialmodelingprep.com/image-stock/${encodeURIComponent(s.s)}.png`;
  if (!LOGO_FAIL.has(a)) return a;
  const d = domainOf(s.web);
  const b = d ? `https://icons.duckduckgo.com/ip3/${d}.ico` : '';
  return b && !LOGO_FAIL.has(b) ? b : '';
}
function logoHtml(s, cls = '') {
  const name = String(s.n || s.s).replace(/^(the)\s+/i, '');
  const letter = (name.match(/[A-Za-z0-9ÄÖÜ]/) || ['?'])[0].toUpperCase();
  let h = 0;
  for (const ch of s.s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const src = logosOn() ? logoSrc(s) : '';
  return `<span class="logo ${cls}" style="--h:${h}" aria-hidden="true"><span class="logo-l">${esc(letter)}</span>${src
    ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" data-logo="${esc(s.s)}" onload="this.parentNode.classList.add('has-img')" onerror="srLogoErr(this)">` : ''}</span>`;
}
window.srLogoErr = (img) => {
  LOGO_FAIL.add(img.src);
  const s = BYSYM[img.dataset.logo];
  const next = s ? logoSrc(s) : '';
  if (next && next !== img.src) img.src = next;
  else img.remove();
};

/* ---------------------------------------------------------------- columns */

function sectorMedian(s, key) {
  const m = (MED[s.sec] && MED[s.sec][key]) ?? (MED._all && MED._all[key]);
  return isNum(m) ? m : null;
}

// Ratio where lower = cheaper; coloured against the sector median.
function ratioCell(key, d = 1) {
  return (s) => {
    const v = s[key];
    if (!isNum(v)) return NA;
    if (v < 0) return '<span class="exp" title="Negativer Gewinn">neg.</span>';
    const m = sectorMedian(s, key);
    let cls = '';
    if (m) { if (v <= 0.8 * m) cls = 'cheap'; else if (v >= 1.25 * m) cls = 'exp'; }
    const mark = key === 'peg' && s.pegSrc === 'calc' ? '<span class="calc" title="Selbst berechnet: Forward-KGV ÷ erwartetes EPS-Wachstum">*</span>' : '';
    const tip = m ? ` title="Branchen-Median: ${NF[1].format(m)}"` : '';
    return `<span class="${cls}"${tip}>${NF[d].format(v)}</span>${mark}`;
  };
}
// Sort key for "lower is better" ratios: negatives behave like +infinity.
const ratioSort = (key) => (s) => (isNum(s[key]) ? (s[key] < 0 ? 1e9 : s[key]) : null);

const COLUMNS = {
  name: {
    label: 'Aktie', cls: 'l sticky name', sort: (s) => s.n?.toLowerCase(), dir: 1,
    render: (s) => {
      const iso = countryIso(s.cty);
      const stale = s.stale ? `<span class="stale" title="Konnte heute nicht aktualisiert werden – Daten vom ${esc(s.stale)}">⚠</span>` : '';
      return `<div class="name-cell"><button class="star ${favs.has(s.s) ? 'on' : ''}" data-fav="${esc(s.s)}" aria-label="Favorit">★</button>${planBtn(s)}${logoHtml(s)}
        <div class="nm-wrap"><span class="nm" title="${esc(s.n)}">${esc(s.n)}</span>
        <span class="tk">${esc(s.s)}${s.type === 'ETF' ? ' · ETF' : iso ? ' · ' + iso : ''}${stale}</span></div></div>`;
    },
  },
  score: {
    label: 'Score', help: 'StockRatio-Score 0–100 (Perzentil): Bewertung, Qualität, Wachstum, Analysten, Momentum.',
    sort: (s) => s.score, dir: -1, cls: 'l',
    render: (s) => isNum(s.score)
      ? `<span class="pill lv-${s.label}"><span class="score-num">${NF[0].format(s.score)}</span><span class="lbl">${esc(s.label)}</span></span>`
      : s.type === 'ETF' ? '<span class="badge b-etf" title="ETFs erhalten keinen Score">ETF</span>' : NA,
  },
  px: { label: 'Kurs', sort: (s) => s.px, dir: -1, render: priceFmt },
  d1: { label: '1 Tag', sort: (s) => s.d1, dir: -1, render: (s) => pct(s.d1, 1, true, true) },
  mcap: { label: 'Marktkap.', help: 'Börsenwert in US-Dollar', sort: (s) => s.mcap, dir: -1, render: (s) => mcapFmt(s.mcap) },
  sec: { label: 'Sektor', cls: 'l', sort: (s) => sectorDe(s.sec), dir: 1, render: (s) => esc(sectorDe(s.sec)) },
  pe: { label: 'KGV', help: 'Kurs-Gewinn-Verhältnis (letzte 12 Monate). Grün/Rot = günstiger/teurer als Branchen-Median.', sort: ratioSort('pe'), dir: 1, render: ratioCell('pe') },
  fpe: { label: 'Fwd-KGV', help: 'Forward-KGV: Kurs ÷ erwarteter Gewinn der nächsten 12 Monate.', sort: ratioSort('fpe'), dir: 1, render: ratioCell('fpe') },
  fpeMed: { label: 'Ø Branche', help: 'Median-Forward-KGV der Branche', sort: (s) => sectorMedian(s, 'fpe'), dir: 1, render: (s) => num(sectorMedian(s, 'fpe')) },
  peg: { label: 'PEG', help: 'KGV ÷ Gewinnwachstum. < 1 günstig, > 2 teuer. * = selbst berechnet.', sort: ratioSort('peg'), dir: 1, render: ratioCell('peg', 2) },
  pb: { label: 'KBV', help: 'Kurs-Buchwert-Verhältnis', sort: ratioSort('pb'), dir: 1, render: ratioCell('pb') },
  ps: { label: 'KUV', help: 'Kurs-Umsatz-Verhältnis', sort: ratioSort('ps'), dir: 1, render: ratioCell('ps') },
  evEbitda: { label: 'EV/EBITDA', help: 'Unternehmenswert ÷ operativer Gewinn vor Abschreibungen', sort: ratioSort('evEbitda'), dir: 1, render: ratioCell('evEbitda') },
  fcfY: { label: 'FCF-Rend.', help: 'Free-Cashflow-Rendite: freier Cashflow ÷ Börsenwert', sort: (s) => s.fcfY, dir: -1, render: (s) => pct(s.fcfY, 1, false, true) },
  divY: { label: 'Div.-Rend.', help: 'Dividendenrendite', sort: (s) => s.divY, dir: -1, render: (s) => pct(s.divY, 1) },
  valB: {
    label: 'Bewertung', help: 'Einordnung aus dem Bewertungs-Score: günstig (≥ 70), fair, teuer (≤ 25)',
    sort: (s) => s.sVal, dir: -1, cls: 'l',
    render: (s) => { const b = valuationBadge(s); return b ? `<span class="badge ${b[1]}">${b[0]}</span>` : NA; },
  },
  roe: { label: 'ROE', help: 'Eigenkapitalrendite', sort: (s) => s.roe, dir: -1, render: (s) => pct(s.roe, 1) },
  opm: { label: 'Op.-Marge', help: 'Operative Marge', sort: (s) => s.opm, dir: -1, render: (s) => pct(s.opm, 1) },
  npm: { label: 'Netto-Marge', sort: (s) => s.npm, dir: -1, render: (s) => pct(s.npm, 1, false, s.npm < 0) },
  de: { label: 'Schulden/EK', help: 'Finanzschulden ÷ Eigenkapital (1,0 = 100 %)', sort: (s) => s.de, dir: 1, render: (s) => num(s.de, 2) },
  revG: { label: 'Umsatz-Wachst.', help: 'Umsatzwachstum ggü. Vorjahresquartal', sort: (s) => s.revG, dir: -1, render: (s) => pct(s.revG, 1, true, true) },
  epsG: { label: 'Gewinn-Wachst.', help: 'Gewinnwachstum ggü. Vorjahresquartal', sort: (s) => s.epsG, dir: -1, render: (s) => pct(s.epsG, 0, true, true) },
  epsGny: { label: 'EPS-Wachst. n. J.', help: 'Erwartetes Gewinnwachstum je Aktie im nächsten Geschäftsjahr', sort: (s) => s.epsGny, dir: -1, render: (s) => pct(s.epsGny, 1, true, true) },
  cons: {
    label: 'Analysten', help: 'Konsens der Analysten und Anteil der Kaufempfehlungen', cls: 'l',
    sort: (s) => (s.nA ? s.rec : null), dir: 1,
    render: (s) => {
      const c = consensus(s.rec, s.nA);
      if (!c) return NA;
      const share = buyShare(s);
      return `<span class="cons cons-${c[1]}">${c[0]}</span>${share !== null ? ` <span class="tk">${NF[0].format(share * 100)} %</span>` : ''}`;
    },
  },
  dist: {
    label: 'Verteilung', help: 'Starker Kauf · Kauf · Halten · Verkauf · Starker Verkauf', cls: 'l',
    sort: (s) => buyShare(s), dir: -1, render: (s) => distMini(s),
  },
  nA: { label: '# Analysten', sort: (s) => s.nA || null, dir: -1, render: (s) => (s.nA ? NF[0].format(s.nA) : NA) },
  tgt: { label: 'Kursziel', help: 'Durchschnittliches Analysten-Kursziel (12 Monate)', sort: (s) => s.tgt, dir: -1, render: (s) => (isNum(s.tgt) ? `${NF[s.tgt >= 1000 ? 0 : 2].format(s.tgt)}` : NA) },
  up: { label: 'Potenzial', help: 'Abstand des Analysten-Kursziels zum aktuellen Kurs', sort: (s) => s.up, dir: -1, render: (s) => pct(s.up, 1, true, true) },
  rev90: { label: 'EPS-Rev. 90T', help: 'Änderung der Gewinnschätzungen in den letzten 90 Tagen', sort: (s) => s.rev90, dir: -1, render: (s) => pct(s.rev90, 1, true, true) },
  r52: { label: '52 W', help: 'Kursentwicklung der letzten 52 Wochen', sort: (s) => s.r52, dir: -1, render: (s) => pct(s.r52, 1, true, true) },
  rel52: { label: 'vs. S&P 500', help: 'Performance der letzten 52 Wochen relativ zum S&P 500', sort: (s) => s.rel52, dir: -1, render: (s) => pct(s.rel52, 1, true, true) },
  ma200: { label: '200-T-Linie', help: 'Abstand zum 200-Tage-Durchschnitt', sort: (s) => s.ma200, dir: -1, render: (s) => pct(s.ma200, 1, true, true) },
  hi52: { label: 'vom 52W-Hoch', help: 'Abstand zum 52-Wochen-Hoch', sort: (s) => s.hi52, dir: -1, render: (s) => pct(s.hi52, 1, true, false) },
  beta: { label: 'Beta', help: 'Schwankung relativ zum Markt (1 = wie der Markt)', sort: (s) => s.beta, dir: 1, render: (s) => num(s.beta, 2) },
};
for (const [key, label] of PILLARS) {
  COLUMNS[key] = { label: label.slice(0, 5) + '.', help: `Teil-Score ${label} (0–100)`, sort: (s) => s[key], dir: -1, render: (s) => num(s[key], 0) };
}
COLUMNS.sVal.label = 'S-Bew.'; COLUMNS.sQual.label = 'S-Qual.'; COLUMNS.sGrow.label = 'S-Wachst.';
COLUMNS.sAna.label = 'S-Anal.'; COLUMNS.sMom.label = 'S-Mom.';

// [id, label, table columns, short label (mobile), card key metrics (big), card details (small)]
const VIEWS = [
  ['overview', 'Übersicht', ['name', 'score', 'px', 'd1', 'mcap', 'pe', 'fpe', 'peg', 'valB', 'cons', 'up', 'rel52'],
    'Übersicht', ['fpe', 'up', 'cons'], ['peg', 'valB', 'pe', 'rel52', 'divY', 'r52']],
  ['valuation', 'Bewertung', ['name', 'score', 'sec', 'pe', 'fpe', 'fpeMed', 'peg', 'pb', 'ps', 'evEbitda', 'fcfY', 'divY', 'sVal'],
    'Bewertung', ['fpe', 'peg', 'valB'], ['pe', 'fpeMed', 'evEbitda', 'fcfY', 'divY', 'pb', 'ps', 'sVal']],
  ['quality', 'Qualität & Wachstum', ['name', 'score', 'sec', 'roe', 'opm', 'npm', 'de', 'revG', 'epsG', 'epsGny', 'sQual', 'sGrow'],
    'Qualität', ['roe', 'revG', 'epsGny'], ['opm', 'npm', 'de', 'epsG', 'sQual', 'sGrow']],
  ['analysts', 'Analysten & Momentum', ['name', 'score', 'cons', 'dist', 'nA', 'up', 'rev90', 'r52', 'rel52', 'ma200', 'hi52', 'beta', 'sAna', 'sMom'],
    'Analysten', ['cons', 'up', 'rel52'], ['nA', 'dist', 'rev90', 'r52', 'ma200', 'hi52', 'beta', 'sMom']],
];

function distMini(s) {
  if (!s.dist) return NA;
  const total = s.dist.reduce((a, b) => a + b, 0);
  const cls = ['d-sb', 'd-b', 'd-h', 'd-s', 'd-ss'];
  const parts = s.dist.map((n, i) => (n ? `<span class="${cls[i]}" style="width:${(n / total) * 100}%"></span>` : '')).join('');
  return `<span class="mini-dist" title="${s.dist.join(' / ')}">${parts}</span>`;
}

/* ---------------------------------------------------------------- presets */

const PRESETS = [
  { id: '', label: 'Alle' },
  { id: 'fav', label: '★ Favoriten', desc: 'Deine mit ★ markierten Aktien und ETFs',
    test: (s) => favs.has(s.s), sort: { key: 'score', dir: -1 } },
  { id: 'cheapStrong', label: 'Günstig & stark', desc: 'Score ≥ 70 und Bewertungs-Score ≥ 60',
    test: (s) => s.score >= 70 && s.sVal >= 60, sort: { key: 'score', dir: -1 } },
  { id: 'garp', label: 'Wachstum fair bewertet', desc: 'PEG < 1, positives Forward-KGV, > 5 % erwartetes Gewinnwachstum, mind. 3 Analysten',
    test: (s) => s.peg > 0 && s.peg < 1 && s.fpe > 0 && s.epsGny > 0.05 && s.nA >= 3, sort: { key: 'peg', dir: 1 } },
  { id: 'value', label: 'Value', desc: 'KGV und Forward-KGV unter 15, solide Qualität',
    test: (s) => s.pe > 0 && s.pe < 15 && s.fpe > 0 && s.fpe < 15 && s.sQual >= 40, sort: { key: 'fpe', dir: 1 } },
  { id: 'analysts', label: 'Analysten-Lieblinge', desc: 'Konsens „Kaufen“ (≤ 1,8), mind. 10 Analysten, ≥ 15 % Kursziel-Potenzial',
    test: (s) => s.rec <= 1.8 && s.nA >= 10 && s.up >= 0.15, sort: { key: 'up', dir: -1 } },
  { id: 'dividend', label: 'Dividende', desc: '≥ 3 % Dividende, Ausschüttungsquote ≤ 80 %, Qualitäts-Score ≥ 50',
    test: (s) => s.divY >= 0.03 && isNum(s.payout) && s.payout <= 0.8 && s.sQual >= 50, sort: { key: 'divY', dir: -1 } },
  { id: 'expensive', label: 'Vorsicht: teuer', desc: 'Die teuersten 15 % nach Bewertungs-Score',
    test: (s) => isNum(s.sVal) && s.sVal <= 15, sort: { key: 'sVal', dir: 1 } },
];

// One sort menu with sensible directions instead of "field + direction".
const SORTS = [
  ['score', -1, 'Bester Score'],
  ['mcap', -1, 'Größte Marktkap.'],
  ['up', -1, 'Höchstes Kurspotenzial'],
  ['fpe', 1, 'Günstigstes Fwd-KGV'],
  ['peg', 1, 'Günstigstes PEG'],
  ['cons', 1, 'Beste Analysten-Wertung'],
  ['rel52', -1, 'Stärkste vs. S&P 500'],
  ['d1', -1, 'Heute: Gewinner'],
  ['d1', 1, 'Heute: Verlierer'],
  ['divY', -1, 'Höchste Dividende'],
  ['name', 1, 'Name A–Z'],
];
const sortId = (key, dir) => `${key}${dir === 1 ? '+' : '-'}`;

// Human-readable text for active filters (shown as removable chips).
const FILTER_TEXT = {
  index: (v) => ({ SP500: 'S&P 500', MSCI: 'MSCI World', FAV: '★ Favoriten', ETF: 'Nur ETFs' }[v] || v),
  region: (v) => (REGIONS.find((r) => r[0] === v) || [])[1] || countryDe(v),
  sector: (v) => sectorDe(v),
  label: (v) => (v === 'pos' ? 'Kaufkandidat + Positiv' : `Signal: ${v}`),
  val: (v) => ({ cheap: 'Bewertung: günstig', notexp: 'Bewertung: nicht teuer', exp: 'Bewertung: teuer' }[v] || v),
  ana: (v) => ({ buy: 'Analysten: mind. Kaufen', strong: 'Analysten: Starker Kauf', hold: 'Analysten: Halten oder schlechter' }[v] || v),
  scoreMin: (v) => `Score ≥ ${v}`,
  fpeMax: (v) => `Fwd-KGV ≤ ${v}`,
  peMax: (v) => `KGV ≤ ${v}`,
  pegMax: (v) => `PEG ≤ ${v}`,
  upMin: (v) => `Potenzial ≥ ${v} %`,
  divMin: (v) => `Dividende ≥ ${v} %`,
  mcapMin: (v) => `Marktkap. ≥ ${v} Mrd. $`,
  noLoss: () => 'Ohne Verlustbringer',
  minAnalysts: () => 'Mind. 5 Analysten',
};
const LIMIT_KEYS = ['scoreMin', 'fpeMax', 'peMax', 'pegMax', 'upMin', 'divMin', 'mcapMin'];
const activeFilterKeys = () => Object.keys(DEFAULT_FILTERS).filter((k) => state.f[k] !== DEFAULT_FILTERS[k] && state.f[k] !== '' && state.f[k] !== null);

/* ---------------------------------------------------------------- filtering */

function parseNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function matches(s) {
  const f = state.f;
  if (state.syms.length && !state.syms.includes(s.s)) return false;
  if (state.q) {
    const q = state.q.toLowerCase();
    if (!(s.s.toLowerCase().includes(q) || (s.n || '').toLowerCase().includes(q) || (s.isin || '').toLowerCase() === q)) return false;
  }
  const preset = PRESETS.find((p) => p.id === state.preset);
  if (preset && preset.test && !preset.test(s)) return false;

  if (f.index) {
    if (f.index === 'FAV') { if (!favs.has(s.s)) return false; }
    else if (f.index === 'ETF') { if (s.type !== 'ETF') return false; }
    else if (!(s.idx || []).includes(f.index)) return false;
  }
  if (f.region) {
    const region = REGIONS.find((r) => r[0] === f.region);
    if (region) { if (!region[2](s.cty)) return false; }
    else if (s.cty !== f.region) return false;
  }
  if (f.sector && s.sec !== f.sector) return false;
  if (f.label) {
    if (f.label === 'pos') { if (!(s.label === 'Kaufkandidat' || s.label === 'Positiv')) return false; }
    else if (s.label !== f.label) return false;
  }
  if (f.val) {
    if (!isNum(s.sVal)) return false;
    if (f.val === 'cheap' && s.sVal < 70) return false;
    if (f.val === 'notexp' && s.sVal <= 25) return false;
    if (f.val === 'exp' && s.sVal > 25) return false;
  }
  if (f.ana) {
    if (!isNum(s.rec) || !s.nA) return false;
    if (f.ana === 'buy' && s.rec > 2.5) return false;
    if (f.ana === 'strong' && s.rec > 1.5) return false;
    if (f.ana === 'hold' && s.rec <= 2.5) return false;
  }
  const maxRatio = (val, lim) => lim === null || (isNum(val) && val > 0 && val <= lim);
  if (!maxRatio(s.pe, parseNum(f.peMax))) return false;
  if (!maxRatio(s.fpe, parseNum(f.fpeMax))) return false;
  if (!maxRatio(s.peg, parseNum(f.pegMax))) return false;
  const minVal = (val, lim, scale = 1) => lim === null || (isNum(val) && val >= lim * scale);
  if (!minVal(s.score, parseNum(f.scoreMin))) return false;
  if (!minVal(s.mcap, parseNum(f.mcapMin))) return false;
  if (!minVal(s.divY, parseNum(f.divMin), 0.01)) return false;
  if (!minVal(s.up, parseNum(f.upMin), 0.01)) return false;
  if (f.noLoss && ((isNum(s.pe) && s.pe < 0) || (isNum(s.fpe) && s.fpe < 0))) return false;
  if (f.minAnalysts && !(s.nA >= 5)) return false;
  return true;
}

function sortRows(rows, sort = state.sort) {
  const col = COLUMNS[sort.key];
  if (!col) return rows;
  const dir = sort.dir;
  return rows
    .map((s) => [col.sort(s), s])
    .sort((a, b) => {
      const va = a[0], vb = b[0];
      const na = va === null || va === undefined || (typeof va === 'number' && !Number.isFinite(va));
      const nb = vb === null || vb === undefined || (typeof vb === 'number' && !Number.isFinite(vb));
      if (na && nb) return 0;
      if (na) return 1; // missing values always last
      if (nb) return -1;
      if (typeof va === 'string') return va.localeCompare(vb, 'de') * dir;
      return (va - vb) * dir;
    })
    .map((x) => x[1]);
}

/* ---------------------------------------------------------------- rendering */

const $ = (sel) => document.querySelector(sel);

function currentView() { return VIEWS.find((v) => v[0] === state.view) || VIEWS[0]; }

function renderHead() {
  $('#table thead').innerHTML = headHtml(currentView()[2], state.sort);
}
function headHtml(cols, sort) {
  return '<tr>' + cols.map((key) => {
    const c = COLUMNS[key];
    const active = sort.key === key;
    const arrow = active ? (sort.dir === 1 ? '▲' : '▼') : '';
    const sortAttr = active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none';
    return `<th class="${c.cls || ''}" data-sort="${key}" aria-sort="${sortAttr}" ${c.help ? `data-help title="${esc(c.help)}"` : ''}>${esc(c.label)}<span class="arrow">${arrow}</span></th>`;
  }).join('') + '</tr>';
}

function renderBody() {
  $('#resultCount').textContent = isMobile()
    ? `${filtered.length.toLocaleString('de-DE')} Aktien`
    : `${filtered.length.toLocaleString('de-DE')} von ${STOCKS.length.toLocaleString('de-DE')} Aktien`;
  if (isMobile()) { renderCards(); return; }
  $('#cards').innerHTML = '';
  $('#more').hidden = true;
  $('#emptyCards').hidden = true;
  const cols = currentView()[2];
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE);
  $('#table tbody').innerHTML = rows.map((s) =>
    `<tr data-sym="${esc(s.s)}" tabindex="0">` +
    cols.map((key) => `<td class="${COLUMNS[key].cls || ''}">${COLUMNS[key].render(s)}</td>`).join('') +
    '</tr>').join('');
  $('#empty').hidden = filtered.length > 0;
  renderPager(pages);
}

function scoreRing(s) {
  if (isNum(s.score)) {
    return `<div class="sc-score lv-${esc(s.label)}" title="StockRatio-Score ${NF[0].format(s.score)} von 100">
      <span class="ring sm" style="--p:${s.score}"><b>${NF[0].format(s.score)}</b></span><span class="lbl">${esc(s.label)}</span></div>`;
  }
  return `<div class="sc-score">${s.type === 'ETF' ? '<span class="badge b-etf">ETF</span>' : '<span class="na">kein Score</span>'}</div>`;
}

function cardHtml(s, extra = '') {
  const view = currentView();
  const [keyFields, moreFields] = [view[4], view[5]];
  const iso = countryIso(s.cty);
  const stale = s.stale ? ' <span class="stale" title="Daten nicht aktuell">⚠</span>' : '';
  const sub = s.type === 'ETF' ? 'ETF' : [iso, sectorDe(s.sec)].filter(Boolean).join(' · ');
  const fav = favs.has(s.s);
  return `<article class="scard" data-sym="${esc(s.s)}" tabindex="0">
    <div class="sc-top">
      ${logoHtml(s, 'lg')}
      <div class="sc-name"><span class="nm">${esc(s.n)}</span>
        <span class="tk"><b class="sym">${esc(s.s)}</b> · ${esc(sub)}${stale}</span></div>
      ${scoreRing(s)}
    </div>
    <div class="sc-px">
      <span class="p">${priceFmt(s)}</span>
      <span class="chg">${pct(s.d1, 1, true, true)}</span>
      <span class="m">${mcapFmt(s.mcap)}</span>
      <span class="sc-act">
        <button class="star ${fav ? 'on' : ''}" data-fav="${esc(s.s)}" aria-label="${fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten'}">★</button>
        ${planBtn(s)}
      </span>
    </div>
    <div class="sc-key">${keyFields.map((k) => `<div><small>${esc(COLUMNS[k].label)}</small><b>${COLUMNS[k].render(s)}</b></div>`).join('')}</div>
    <dl class="sc-more">${moreFields.map((k) => `<div><dt>${esc(COLUMNS[k].label)}</dt><dd>${COLUMNS[k].render(s)}</dd></div>`).join('')}</dl>
    ${extra}
  </article>`;
}

function renderCards() {
  $('#table tbody').innerHTML = '';
  const rows = filtered.slice(0, state.shown);
  $('#cards').innerHTML = rows.map((s) => cardHtml(s)).join('');
  const rest = filtered.length - rows.length;
  const more = $('#more');
  more.hidden = rest <= 0;
  more.textContent = `Weitere ${Math.min(CARD_STEP, rest)} anzeigen (noch ${rest.toLocaleString('de-DE')})`;
  $('#emptyCards').hidden = filtered.length > 0;
  $('#pager').innerHTML = '';
}

function renderSortSelect() {
  const cur = sortId(state.sort.key, state.sort.dir);
  const opts = SORTS.map(([k, d, label]) => [sortId(k, d), label]);
  if (!opts.some(([id]) => id === cur) && COLUMNS[state.sort.key]) {
    opts.push([cur, `${COLUMNS[state.sort.key].label} ${state.sort.dir === 1 ? '↑' : '↓'}`]);
  }
  $('#sortSel').innerHTML = opts.map(([id, label]) => `<option value="${id}" ${id === cur ? 'selected' : ''}>${esc(label)}</option>`).join('');
}

function renderPager(pages) {
  const p = state.page;
  if (pages <= 1) { $('#pager').innerHTML = ''; return; }
  const btn = (n, label = n, disabled = false) =>
    `<button data-page="${n}" ${n === p && label === n ? 'aria-current="page"' : ''} ${disabled ? 'disabled' : ''}>${label}</button>`;
  const set = new Set([1, pages, p - 1, p, p + 1].filter((n) => n >= 1 && n <= pages));
  const nums = [...set].sort((a, b) => a - b);
  let html = btn(p - 1, '‹', p === 1);
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) html += '<span>…</span>';
    html += btn(n);
  });
  html += btn(p + 1, '›', p === pages);
  $('#pager').innerHTML = html;
}

function renderPresets() {
  $('#presets').innerHTML = PRESETS.map((p) => {
    const count = p.test ? STOCKS.filter(p.test).length : STOCKS.length;
    return `<button class="chip" data-preset="${p.id}" aria-pressed="${state.preset === p.id}" ${p.desc ? `title="${esc(p.desc)}"` : ''}>${esc(p.label)}<small>${count}</small></button>`;
  }).join('');
}

function renderViews() {
  $('#views').innerHTML = VIEWS.map(([id, label, , short]) =>
    `<button role="tab" data-view="${id}" aria-selected="${state.view === id}"><span class="long">${label}</span><span class="short">${short || label}</span></button>`).join('');
}

function syncFilterInputs() {
  document.querySelectorAll('[data-f]').forEach((el) => {
    const value = state.f[el.dataset.f];
    if (el.type === 'checkbox') el.checked = !!value;
    else if (el.type === 'radio') el.checked = String(value ?? '') === el.value;
    else {
      el.value = value ?? '';
      el.classList.toggle('active-f', value !== '' && value !== null && value !== undefined);
    }
  });
  const active = activeFilterKeys();
  const badge = $('#filterCount');
  badge.hidden = active.length === 0;
  badge.textContent = active.length;
  const limits = active.filter((k) => LIMIT_KEYS.includes(k)).length;
  $('#fMoreCount').hidden = !limits;
  $('#fMoreCount').textContent = limits;
  if (limits) $('#fMore').open = true;

  const box = $('#activeFilters');
  const n = state.syms.length;
  box.hidden = active.length === 0 && !n;
  box.innerHTML = (n ? `<button class="afchip af-sel" data-clear="syms" aria-label="Auswahl aufheben">🔔 Auswahl: ${n} ${n === 1 ? 'Aktie' : 'Aktien'}<span aria-hidden="true">×</span></button>` : '')
    + active.map((k) =>
    `<button class="afchip" data-clear="${k}" aria-label="Filter entfernen: ${esc(FILTER_TEXT[k](state.f[k]))}">${esc(FILTER_TEXT[k](state.f[k]))}<span aria-hidden="true">×</span></button>`).join('')
    + (active.length + (n ? 1 : 0) > 1 ? '<button class="afclear" data-clear="*">Alle entfernen</button>' : '');
}

function update({ resetPage = true } = {}) {
  if (resetPage) { state.page = 1; state.shown = CARD_STEP; }
  filtered = sortRows(STOCKS.filter(matches));
  renderHead();
  renderBody();
  document.querySelectorAll('#presets .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.preset === state.preset)));
  document.querySelectorAll('#views button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  syncFilterInputs();
  renderSortSelect();
  $('#applyFilters').textContent = `${filtered.length.toLocaleString('de-DE')} Aktien anzeigen`;
  writeHash();
}

/* ---------------------------------------------------------------- URL state */

function writeHash() {
  const p = new URLSearchParams();
  if (state.mode === 'portfolio') p.set('m', 'pf');
  if (state.q) p.set('q', state.q);
  if (state.syms.length) p.set('syms', state.syms.join(','));
  if (state.preset) p.set('p', state.preset);
  if (state.view !== 'overview') p.set('v', state.view);
  if (!(state.sort.key === 'mcap' && state.sort.dir === -1)) p.set('s', `${state.sort.key}${state.sort.dir === 1 ? '+' : '-'}`);
  for (const [k, v] of Object.entries(state.f)) {
    if (v !== DEFAULT_FILTERS[k] && v !== '') p.set(k, v === true ? '1' : v);
  }
  const hash = p.toString();
  // keep history.state so an open detail view / filter sheet can still be closed with "back"
  history.replaceState(history.state, '', hash ? `#${hash}` : location.pathname + location.search);
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.q = p.get('q') || '';
  state.syms = (p.get('syms') || '').split(',').map((x) => x.trim()).filter(Boolean);
  state.mode = p.get('m') === 'pf' ? 'portfolio' : 'screener';
  const preset = p.get('p') === 'watch' ? 'fav' : p.get('p');
  state.preset = PRESETS.some((x) => x.id === preset) ? preset : '';
  if (preset === 'top' && !p.get('s')) state.sort = { key: 'score', dir: -1 }; // old "Top-Score" links
  state.view = VIEWS.some((v) => v[0] === p.get('v')) ? p.get('v') : 'overview';
  const s = p.get('s');
  if (s && COLUMNS[s.slice(0, -1)]) state.sort = { key: s.slice(0, -1), dir: s.endsWith('+') ? 1 : -1 };
  for (const k of Object.keys(DEFAULT_FILTERS)) {
    if (p.has(k)) state.f[k] = typeof DEFAULT_FILTERS[k] === 'boolean' ? p.get(k) === '1' : p.get(k);
  }
}

/* ---------------------------------------------------------------- detail view */

function reasons(s) {
  const plus = [], minus = [];
  const med = (k) => sectorMedian(s, k);
  const P = (v, d = 0) => NF[d].format(Math.abs(v * 100)) + ' %';

  if (isNum(s.fpe) && s.fpe < 0) minus.push('Analysten erwarten Verluste (negatives Forward-KGV)');
  else if (isNum(s.pe) && s.pe < 0) minus.push('Aktuell Verluste (negatives KGV)');
  if (s.fpe > 0 && med('fpe')) {
    const d = s.fpe / med('fpe') - 1;
    if (d <= -0.2) plus.push(`Forward-KGV ${NF[1].format(s.fpe)} liegt ${P(d)} unter dem Branchen-Median (${NF[1].format(med('fpe'))})`);
    if (d >= 0.25) minus.push(`Forward-KGV ${NF[1].format(s.fpe)} liegt ${P(d)} über dem Branchen-Median (${NF[1].format(med('fpe'))})`);
  }
  if (s.peg > 0 && s.peg < 1) plus.push(`PEG ${NF[2].format(s.peg)}: Wachstum im Kurs günstig bewertet`);
  if (s.peg > 2.5) minus.push(`PEG ${NF[2].format(s.peg)}: Kurs hoch im Verhältnis zum Wachstum`);
  if (s.fcfY >= 0.05) plus.push(`Hohe Free-Cashflow-Rendite von ${P(s.fcfY, 1)}`);
  if (isNum(s.fcfY) && s.fcfY < 0) minus.push('Negativer freier Cashflow');
  if (s.roe >= 0.2) plus.push(`Hohe Eigenkapitalrendite (${P(s.roe)})`);
  if (isNum(s.npm) && s.npm < 0) minus.push('Unternehmen arbeitet mit Verlust (negative Netto-Marge)');
  if (s.de > 2 && s.sec !== 'Financial Services' && s.sec !== 'Real Estate') minus.push(`Hohe Verschuldung (Schulden = ${NF[1].format(s.de)}× Eigenkapital)`);
  if (s.epsGny >= 0.15) plus.push(`Analysten erwarten +${P(s.epsGny)} Gewinnwachstum im nächsten Jahr`);
  if (isNum(s.epsGny) && s.epsGny < 0) minus.push(`Analysten erwarten ${P(s.epsGny)} weniger Gewinn im nächsten Jahr`);
  const share = buyShare(s);
  if (s.nA >= 5 && share !== null && share >= 0.7) plus.push(`${NF[0].format(share * 100)} % der Analysten empfehlen Kaufen`);
  if (s.nA >= 3 && s.rec >= 3) minus.push('Analysten-Konsens nur „Halten“ oder schlechter');
  if (s.up >= 0.2 && s.nA >= 3) plus.push(`Kursziel der Analysten ${P(s.up)} über dem aktuellen Kurs`);
  if (isNum(s.up) && s.up < -0.05 && s.nA >= 3) minus.push(`Kurs liegt ${P(s.up)} über dem Analysten-Kursziel`);
  if (s.rev90 >= 0.03) plus.push(`Gewinnschätzungen in 90 Tagen um ${P(s.rev90, 1)} angehoben`);
  if (s.rev90 <= -0.03) minus.push(`Gewinnschätzungen in 90 Tagen um ${P(s.rev90, 1)} gesenkt`);
  if (s.rel52 >= 0.1) plus.push(`${P(s.rel52)} besser gelaufen als der S&P 500 (52 Wochen)`);
  if (s.rel52 <= -0.15) minus.push(`${P(s.rel52)} schwächer gelaufen als der S&P 500 (52 Wochen)`);
  if (s.divY >= 0.03) plus.push(`Dividendenrendite ${P(s.divY, 1)}`);
  return [plus.slice(0, 6), minus.slice(0, 6)];
}

function openDetail(sym) {
  const s = STOCKS.find((x) => x.s === sym);
  if (!s) return;
  const c = consensus(s.rec, s.nA);
  const share = buyShare(s);
  const [plus, minus] = reasons(s);
  const iso = countryIso(s.cty);
  const idxNames = { SP500: 'S&P 500', MSCI: 'MSCI World', WL: 'watchlist.txt' };
  const isEtf = s.type === 'ETF';
  const held = PF.positions.find((p) => p.s === s.s);
  const heldVal = held ? positionValue(held) : null;
  const tags = [
    isEtf ? 'ETF' : null,
    isEtf && isNum(s.aum) ? `Fondsvolumen ${mcapFmt(s.aum)}` : null,
    s.sec ? `${sectorDe(s.sec)}${s.ind ? ' · ' + s.ind : ''}` : null,
    s.cty ? countryDe(s.cty) : null,
    ...(s.idx || []).map((i) => idxNames[i]),
    isNum(s.w) ? `MSCI-Gewicht ${NF[2].format(s.w)} %` : null,
  ].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('');

  const bars = PILLARS.map(([key, label]) => {
    const v = s[key];
    const col = !isNum(v) ? '' : v >= 70 ? 'var(--pos)' : v < 30 ? 'var(--neg)' : 'var(--accent)';
    return `<div class="bar-row"><span>${label}</span><span class="bar"><i style="width:${isNum(v) ? v : 0}%${col ? ';background:' + col : ''}"></i></span><b>${isNum(v) ? NF[0].format(v) : '–'}</b></div>`;
  }).join('');

  const distLabels = ['Starker Kauf', 'Kaufen', 'Halten', 'Verkaufen', 'Starker Verkauf'];
  const distCls = ['d-sb', 'd-b', 'd-h', 'd-s', 'd-ss'];
  const distTotal = s.dist ? s.dist.reduce((a, b) => a + b, 0) : 0;
  const dist = s.dist
    ? `<div class="dist-bar">${s.dist.map((n, i) => (n ? `<span class="${distCls[i]}" style="width:${(n / distTotal) * 100}%"></span>` : '')).join('')}</div>
       <div class="dist-legend">${s.dist.map((n, i) => `<span><i class="${distCls[i]}"></i>${distLabels[i]}: ${n}</span>`).join('')}</div>`
    : '';

  const mrow = (label, key, fmt, lowerBetter = true) => {
    const v = s[key], m = sectorMedian(s, key);
    let verdict = '';
    if (isNum(v) && isNum(m) && m !== 0) {
      if (lowerBetter && v < 0) verdict = '<span class="exp">Verlust</span>';
      else {
        const r = v / m;
        const good = lowerBetter ? r <= 0.8 : r >= 1.2;
        const bad = lowerBetter ? r >= 1.25 : r <= 0.8;
        verdict = good ? '<span class="cheap">besser</span>' : bad ? '<span class="exp">schlechter</span>' : '<span class="muted">ähnlich</span>';
      }
    }
    return `<tr><td>${label}</td><td>${fmt(v)}</td><td>${isNum(m) ? fmt(m) : NA}</td><td>${verdict}</td></tr>`;
  };
  const r1 = (v) => (isNum(v) && v < 0 ? 'neg.' : num(v, 1));
  const r2 = (v) => num(v, 2);
  const p1 = (v) => pct(v, 1);

  const scoreText = isNum(s.score)
    ? `Attraktiver als ${NF[0].format(s.score)} % aller ${STOCKS.length.toLocaleString('de-DE')} Aktien im Screener.`
    : 'Zu wenige Daten für einen Score.';

  $('#detailBody').innerHTML = `
    <div class="d-head">
      ${logoHtml(s, 'xl')}
      <div class="d-title">
        <h2 id="dTitle">${esc(s.n)}</h2>
        <div class="tk">${esc(s.s)}${s.ex ? ' · ' + esc(s.ex) : ''}${s.isin ? ' · ISIN ' + esc(s.isin) : ''}${iso ? ' · ' + iso : ''}</div>
      </div>
      <button class="close" aria-label="Schließen" data-close>×</button>
    </div>
    <div class="d-tags">${tags}</div>
    <div class="d-price">${priceFmt(s)} <small>${pct(s.d1, 2, true, true)} heute</small>${isNum(s.mcap) ? ` <small class="muted">· ${mcapFmt(s.mcap)}</small>` : ''}</div>
    ${held ? `<div class="d-held">Im Portfolio: <b>${money(heldVal)}</b> · ${fmtShares(held.shares)} Stück</div>` : ''}
    ${s.stale ? `<p class="stale">⚠ Konnte zuletzt nicht aktualisiert werden – Daten vom ${esc(s.stale)}.</p>` : ''}

    <div class="d-grid">
      ${isEtf ? `<section class="card"><h3>ETF</h3><p class="muted">Für ETFs gibt es keinen StockRatio-Score, kein KGV und keine Analystenbewertung –
        diese Kennzahlen beziehen sich auf einzelne Unternehmen. Angezeigt werden Kurs und Kursentwicklung.</p></section>` : `
      <section class="card lv-${esc(s.label || 'Neutral')}">
        <h3>StockRatio-Score</h3>
        <div class="score-big">
          <div class="ring" style="--p:${isNum(s.score) ? s.score : 0}"><b>${isNum(s.score) ? NF[0].format(s.score) : '–'}</b></div>
          <div>${s.label ? `<span class="lbl">${esc(s.label)}</span>` : ''}<p>${scoreText}</p></div>
        </div>
        ${bars}
      </section>

      <section class="card">
        <h3>Analysten</h3>
        ${c ? `<div class="cons-big cons-${c[1]}">${c[0]}</div>
          <div class="muted">${share !== null ? `${NF[0].format(share * 100)} % Kaufempfehlungen · ` : ''}${s.nA} Analysten · Ø ${NF[2].format(s.rec)} (1 = Starker Kauf, 5 = Verkaufen)</div>
          ${dist}` : '<p class="muted">Keine Analystenabdeckung.</p>'}
        <div class="kv">
          <span>Ø Kursziel (12 M)</span><span>${isNum(s.tgt) ? NF[2].format(s.tgt) + ' ' + esc(s.cur || '') : '–'}</span>
          <span>Potenzial</span><span>${pct(s.up, 1, true, true)}</span>
          <span>Gewinnschätzung 90 T</span><span>${pct(s.rev90, 1, true, true)}</span>
        </div>
      </section>`}

      <section class="card">
        <h3>Kursentwicklung</h3>
        <div class="cons-big">${pct(s.rel52, 1, true, true)} <span class="muted" style="font-size:13px;font-weight:500">vs. S&amp;P 500</span></div>
        <div class="muted">Relative Performance der letzten 52 Wochen</div>
        <div class="kv">
          <span>Performance 52 W</span><span>${pct(s.r52, 1, true, true)}</span>
          <span>S&amp;P 500 52 W</span><span>${pct(DATA.sp500_52w, 1, true, true)}</span>
          <span>Abstand 200-Tage-Linie</span><span>${pct(s.ma200, 1, true, true)}</span>
          <span>Abstand 52-W-Hoch</span><span>${pct(s.hi52, 1, true)}</span>
          <span>Beta</span><span>${num(s.beta, 2)}</span>
        </div>
      </section>
      ${isEtf ? '' : `
      <section class="card">
        <h3>Einordnung</h3>
        <ul class="reasons">
          ${plus.map((t) => `<li class="r-plus">${esc(t)}</li>`).join('')}
          ${minus.map((t) => `<li class="r-minus">${esc(t)}</li>`).join('')}
          ${!plus.length && !minus.length ? '<li class="muted">Keine auffälligen Stärken oder Schwächen.</li>' : ''}
        </ul>
      </section>

      <section class="card full">
        <h3>Kennzahlen vs. Branche (${esc(sectorDe(s.sec))})</h3>
        <table class="metrics">
          <thead><tr><th>Kennzahl</th><th>Aktie</th><th>Branchen-Median</th><th>Vergleich</th></tr></thead>
          <tbody>
            ${mrow('KGV', 'pe', r1)}
            ${mrow('Forward-KGV', 'fpe', r1)}
            ${mrow('PEG' + (s.pegSrc === 'calc' ? ' *' : ''), 'peg', r2)}
            ${mrow('KBV', 'pb', r1)}
            ${mrow('KUV', 'ps', r1)}
            ${mrow('EV/EBITDA', 'evEbitda', r1)}
            ${mrow('FCF-Rendite', 'fcfY', p1, false)}
            ${mrow('Dividendenrendite', 'divY', p1, false)}
            ${mrow('Eigenkapitalrendite', 'roe', p1, false)}
            ${mrow('Operative Marge', 'opm', p1, false)}
            ${mrow('Umsatzwachstum', 'revG', p1, false)}
            ${mrow('EPS-Wachstum n. J.', 'epsGny', p1, false)}
          </tbody>
        </table>
      </section>`}
    </div>

    <div class="links">
      <a href="https://finance.yahoo.com/quote/${encodeURIComponent(s.s)}" target="_blank" rel="noopener">Yahoo Finance ↗</a>
      ${s.web && /^https?:\/\//.test(s.web) ? `<a href="${esc(s.web)}" target="_blank" rel="noopener">Unternehmens-Website ↗</a>` : ''}
      <button class="btn ghost" data-fav="${esc(s.s)}">${favs.has(s.s) ? '★ Aus Favoriten entfernen' : '☆ Zu Favoriten'}</button>
      <button class="btn ghost" data-pf="${esc(s.s)}">${held ? '✎ Portfolio-Position bearbeiten' : '+ Zum Portfolio'}</button>
      ${planBtn(s, true)}
    </div>`;
  const dlg = $('#detail');
  if (!dlg.open) {
    dlg.showModal();
    history.pushState({ sr: 'detail' }, '');
  }
  dlg.scrollTop = 0;
}

/* ---------------------------------------------------------------- export */

function exportCsv() {
  const cols = [
    ['Ticker', (s) => s.s], ['Name', (s) => s.n], ['ISIN', (s) => s.isin], ['Land', (s) => countryDe(s.cty)],
    ['Sektor', (s) => sectorDe(s.sec)], ['Score', (s) => s.score], ['Signal', (s) => s.label],
    ['Kurs', (s) => s.px], ['Währung', (s) => s.cur], ['Marktkap. Mrd USD', (s) => s.mcap],
    ['KGV', (s) => s.pe], ['Forward-KGV', (s) => s.fpe], ['PEG', (s) => s.peg], ['KBV', (s) => s.pb],
    ['KUV', (s) => s.ps], ['EV/EBITDA', (s) => s.evEbitda], ['FCF-Rendite %', (s) => pctRaw(s.fcfY)],
    ['Dividende %', (s) => pctRaw(s.divY)], ['ROE %', (s) => pctRaw(s.roe)], ['Op.-Marge %', (s) => pctRaw(s.opm)],
    ['Umsatzwachstum %', (s) => pctRaw(s.revG)], ['EPS-Wachstum n.J. %', (s) => pctRaw(s.epsGny)],
    ['Analysten-Konsens', (s) => (consensus(s.rec, s.nA) || [''])[0]], ['Analysten Ø', (s) => s.rec],
    ['Anzahl Analysten', (s) => s.nA], ['Kursziel', (s) => s.tgt], ['Potenzial %', (s) => pctRaw(s.up)],
    ['52W %', (s) => pctRaw(s.r52)], ['vs. S&P 500 %', (s) => pctRaw(s.rel52)],
    ['S-Bewertung', (s) => s.sVal], ['S-Qualität', (s) => s.sQual], ['S-Wachstum', (s) => s.sGrow],
    ['S-Analysten', (s) => s.sAna], ['S-Momentum', (s) => s.sMom],
  ];
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    const t = String(v);
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [cols.map((c) => c[0]).join(';'), ...filtered.map((s) => cols.map((c) => cell(c[1](s))).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `stockratio-${(DATA.generated || '').slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function pctRaw(v) { return isNum(v) ? Math.round(v * 1000) / 10 : null; }

/* ---------------------------------------------------------------- events */

function toggleFav(sym) {
  if (favs.has(sym)) favs.delete(sym); else favs.add(sym);
  store.set(FAV_KEY, [...favs]);
  if (state.mode === 'portfolio') renderPortfolio();
}

function setFiltersOpen(open, { fromHistory = false } = {}) {
  const box = $('#filters');
  if (box.hidden === !open) return;
  box.hidden = !open;
  $('#toggleFilters').setAttribute('aria-expanded', String(open));
  if (isMobile()) {
    document.body.classList.toggle('sheet-open', open);
    if (open) history.pushState({ sr: 'filters' }, '');
    else if (!fromHistory && history.state && history.state.sr === 'filters') history.back();
    if (!open) window.scrollTo({ top: 0 });
  } else {
    store.set('stockratio.filtersOpen', open);
  }
}

function bindEvents() {
  let qTimer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = e.target.value.trim(); update(); }, 150);
  });

  $('#toggleFilters').addEventListener('click', () => setFiltersOpen($('#filters').hidden));
  $('#closeFilters').addEventListener('click', () => setFiltersOpen(false));
  $('#applyFilters').addEventListener('click', () => setFiltersOpen(false));

  const resetAll = () => {
    state.q = ''; $('#q').value = '';
    state.syms = [];
    state.preset = '';
    state.f = { ...DEFAULT_FILTERS };
    state.sort = { key: 'mcap', dir: -1 };
    update();
  };
  $('#resetSheet').addEventListener('click', resetAll);

  $('#activeFilters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-clear]');
    if (!b) return;
    if (b.dataset.clear === '*') { state.f = { ...DEFAULT_FILTERS }; state.syms = []; }
    else if (b.dataset.clear === 'syms') state.syms = [];
    else state.f[b.dataset.clear] = DEFAULT_FILTERS[b.dataset.clear];
    update();
  });

  $('#sortSel').addEventListener('change', (e) => {
    const v = e.target.value;
    const key = v.slice(0, -1);
    if (COLUMNS[key]) state.sort = { key, dir: v.endsWith('+') ? 1 : -1 };
    update();
  });

  $('#more').addEventListener('click', () => { state.shown += CARD_STEP; renderCards(); });

  $('#cards').addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      e.stopPropagation();
      toggleFav(fav.dataset.fav);
      fav.classList.toggle('on', favs.has(fav.dataset.fav));
      renderPresets();
      update({ resetPage: false });
      return;
    }
    const card = e.target.closest('[data-sym]');
    if (card) openDetail(card.dataset.sym);
  });
  $('#cards').addEventListener('keydown', (e) => {
    const card = e.target.closest('.scard');
    if (card && e.key === 'Enter') openDetail(card.dataset.sym);
  });

  // "back" closes the detail view / filter sheet instead of leaving the page
  window.addEventListener('popstate', () => {
    const dlg = $('#detail');
    if (dlg.open) dlg.close();
    if (isMobile() && !$('#filters').hidden) setFiltersOpen(false, { fromHistory: true });
    writeHash(); // the previous history entry may carry an older hash
  });
  $('#detail').addEventListener('close', () => {
    if (history.state && history.state.sr === 'detail') history.back();
  });

  // desktop: "/" focuses the search
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !$('#detail').open) {
      e.preventDefault();
      $('#q').focus();
    }
    if (e.key === 'Escape' && isMobile() && !$('#filters').hidden) setFiltersOpen(false);
  });

  // mobile: shadow under the sticky search bar once it sticks
  const row = $('.search-row');
  window.addEventListener('scroll', () => row.classList.toggle('stuck', window.scrollY > 60), { passive: true });

  MOBILE.addEventListener('change', () => {
    document.body.classList.remove('sheet-open');
    update({ resetPage: false });
    if (state.mode === 'portfolio') renderPortfolio();
  });

  $('#export').addEventListener('click', exportCsv);

  document.querySelectorAll('[data-f]').forEach((el) => {
    const handler = () => {
      state.f[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
      update();
    };
    el.addEventListener(el.tagName === 'INPUT' && el.type !== 'checkbox' ? 'input' : 'change', handler);
  });

  $('#presets').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-preset]');
    if (!chip) return;
    const id = chip.dataset.preset;
    state.preset = state.preset === id ? '' : id;
    const preset = PRESETS.find((p) => p.id === state.preset);
    if (preset && preset.sort) state.sort = { ...preset.sort };
    if (!state.preset) state.sort = { key: 'mcap', dir: -1 };
    update();
  });

  $('#views').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    state.view = b.dataset.view;
    if (!currentView()[2].includes(state.sort.key) && state.sort.key !== 'mcap') state.sort = { key: 'score', dir: -1 };
    update({ resetPage: false });
  });

  $('#table thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (state.sort.key === key) state.sort.dir *= -1;
    else state.sort = { key, dir: COLUMNS[key].dir || -1 };
    update();
  });

  $('#table tbody').addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      e.stopPropagation();
      toggleFav(fav.dataset.fav);
      fav.classList.toggle('on', favs.has(fav.dataset.fav));
      renderPresets();
      update({ resetPage: false });
      return;
    }
    const tr = e.target.closest('tr[data-sym]');
    if (tr) openDetail(tr.dataset.sym);
  });
  $('#table tbody').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const tr = e.target.closest('tr[data-sym]');
    if (tr) openDetail(tr.dataset.sym);
  });

  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

  $('#pager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b || b.disabled) return;
    state.page = Number(b.dataset.page);
    renderBody();
    $('#tableWrap').scrollTop = 0;
    $('#tableWrap').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  const dlg = $('#detail');
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
    const pfBtn = e.target.closest('[data-pf]');
    if (pfBtn) {
      dlg.close();
      setMode('portfolio');
      startEdit(pfBtn.dataset.pf);
      return;
    }
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      toggleFav(fav.dataset.fav);
      openDetail(fav.dataset.fav);
      renderPresets();
      update({ resetPage: false });
    }
  });
}

/* ---------------------------------------------------------------- portfolio */

const MINOR_CUR = { GBp: ['GBP', 0.01], GBX: ['GBP', 0.01], ZAc: ['ZAR', 0.01], ILA: ['ILS', 0.01] };
const CUR_SIGN = { EUR: '€', USD: '$' };
const pf = { sel: null, editing: null };

function usdPerUnit(cur) {
  const [major, mult] = MINOR_CUR[cur] || [cur, 1];
  const rate = (DATA && DATA.fx || {})[major];
  return isNum(rate) ? rate * mult : null;
}
// price of one share in the portfolio currency
function priceIn(s, target = PF.cur) {
  const from = usdPerUnit(s.cur), to = usdPerUnit(target);
  return isNum(s.px) && from && to ? (s.px * from) / to : null;
}
function positionValue(p) {
  const s = BYSYM[p.s];
  const price = s ? priceIn(s) : null;
  return price !== null ? price * p.shares : null;
}
function money(v, digits = 2) {
  if (!isNum(v)) return '–';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: PF.cur, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}
function fmtShares(n) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: n >= 100 ? 2 : 4 }).format(n);
}
function parseAmount(text) {
  let t = String(text || '').trim().replace(/[\s€$]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // 2.500
  const n = parseFloat(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function setMode(mode, { initial = false } = {}) {
  state.mode = mode === 'portfolio' ? 'portfolio' : 'screener';
  const isPf = state.mode === 'portfolio';
  $('#screenerView').hidden = isPf;
  $('#portfolioView').hidden = !isPf;
  document.querySelectorAll('#modes [data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === state.mode)));
  if (isPf) renderPortfolio();
  else if (!initial) update({ resetPage: false });
  writeHash();
  if (!initial) window.scrollTo({ top: 0 });
}

/* Portfolio views: "perf" (value & performance since purchase) and "scan" (screener cards + warning signs) */
const PFVIEW_KEY = 'stockratio.pf.view';
const pfUi = { view: store.get(PFVIEW_KEY, 'perf') === 'scan' ? 'scan' : 'perf', sort: { key: 'warn', dir: -1 } };
const PF_SORTS = [
  ['warn', -1, 'Meiste Warnsignale'],
  ['score', 1, 'Schwächster Score'],
  ['pfPct', 1, 'Schlechteste Entwicklung'],
  ['pfPct', -1, 'Beste Entwicklung'],
  ['pfVal', -1, 'Größte Position'],
  ['d1', 1, 'Heute: Verlierer'],
  ['score', -1, 'Bester Score'],
];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dataDate = () => String((DATA && DATA.generated) || '').slice(0, 10) || todayIso();
const holdFor = (iso) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(days) || days < 0) return '';
  if (days < 1) return 'heute';
  if (days < 60) return `${days} ${days === 1 ? 'Tag' : 'Tage'}`;
  if (days < 730) return `${Math.round(days / 30.4)} Mon.`;
  return `${NF[1].format(days / 365.25)} J.`;
};

// purchase cost of a position in the portfolio currency (stored at the FX rate of the day it was entered)
function positionCost(p) {
  if (p.cost && isNum(p.cost[PF.cur])) return p.cost[PF.cur];
  const s = BYSYM[p.s];
  if (s && isNum(p.buyPx)) {
    const from = usdPerUnit(s.cur), to = usdPerUnit(PF.cur);
    if (from && to) return (p.shares * p.buyPx * from) / to;
  }
  return null;
}
function posPerf(p) {
  const value = positionValue(p);
  const cost = positionCost(p);
  const gain = isNum(value) && isNum(cost) ? value - cost : null;
  return { value, cost, gain, pct: isNum(gain) && cost > 0 ? gain / cost : null };
}
const posOf = (sym) => PF.positions.find((p) => p.s === sym);
const signed = (v, d = 2) => (isNum(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v), d)}` : '–');
const perfCls = (v) => (isNum(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : '') : '');

// the score is remembered when a position is added (or first seen) to show later deterioration
function ensureRefScores() {
  let changed = false;
  for (const p of PF.positions) {
    const s = BYSYM[p.s];
    if (s && isNum(s.score) && !isNum(p.refScore)) { p.refScore = s.score; p.refDate = dataDate(); changed = true; }
  }
  if (changed) savePF();
}

// signs that a holding is getting weaker
function weakSignals(s) {
  const w = [];
  const etf = s.type === 'ETF';
  const p = posOf(s.s);
  if (p && isNum(p.refScore) && isNum(s.score) && s.score <= p.refScore - 15) {
    w.push(`Score gefallen: ${NF[0].format(p.refScore)} → ${NF[0].format(s.score)}`);
  }
  if (!etf && isNum(s.score) && s.score < 30) w.push(`Signal „${s.label}“`);
  if (!etf && s.nA >= 3 && isNum(s.rec) && s.rec > 2.5) w.push(s.rec > 3.5 ? 'Analysten raten zum Verkauf' : 'Analysten nur „Halten“');
  if (!etf && isNum(s.rev90) && s.rev90 <= -0.03) w.push(`Gewinnschätzungen gesenkt (${pct(s.rev90, 0, true)})`);
  if (!etf && s.nA >= 3 && isNum(s.up) && s.up < 0) w.push('Kurs über dem Kursziel');
  if (isNum(s.ma200) && s.ma200 < 0) w.push('Unter der 200-Tage-Linie');
  if (isNum(s.hi52) && s.hi52 <= -0.25) w.push(`${pct(s.hi52, 0)} vom 52-W-Hoch`);
  if (!etf && isNum(s.rel52) && s.rel52 <= -0.15) w.push('Deutlich schwächer als der S&P 500');
  return w;
}

COLUMNS.warn = {
  label: 'Warnsignale', cls: 'l', help: 'Hinweise, dass sich die Aktie verschlechtert (Score, Analysten, Trend)',
  sort: (s) => weakSignals(s).length * 1000 + (100 - (isNum(s.score) ? s.score : 50)), dir: -1,
  render: (s) => {
    const w = weakSignals(s);
    if (!w.length) return '<span class="ok-txt">✓ keine</span>';
    return `<span class="warn-n" title="${esc(w.join(' · '))}">⚠ ${w.length}</span> <span class="tk">${esc(w[0])}${w.length > 1 ? ' …' : ''}</span>`;
  },
};
COLUMNS.pfPct = {
  label: 'Seit Kauf', help: 'Entwicklung der Position seit dem Kauf', sort: (s) => (posOf(s.s) ? posPerf(posOf(s.s)).pct : null), dir: -1,
  render: (s) => { const p = posOf(s.s); const r = p ? posPerf(p) : {}; return isNum(r.pct) ? pct(r.pct, 1, true, true) : NA; },
};
COLUMNS.pfVal = {
  label: 'Wert', help: 'Aktueller Wert der Position', sort: (s) => (posOf(s.s) ? positionValue(posOf(s.s)) : null), dir: -1,
  render: (s) => { const p = posOf(s.s); return p ? money(positionValue(p), 0) : NA; },
};

function renderPortfolio() {
  if (!DATA) return;
  ensureRefScores();
  const rows = PF.positions
    .map((p) => {
      const s = BYSYM[p.s];
      const perf = posPerf(p);
      const day = isNum(perf.value) && s && isNum(s.d1) ? perf.value - perf.value / (1 + s.d1) : null;
      return { p, s, ...perf, day };
    })
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const total = rows.reduce((a, r) => a + (r.value || 0), 0);
  const dayTotal = rows.reduce((a, r) => a + (r.day || 0), 0);
  const dayPct = total - dayTotal > 0 ? dayTotal / (total - dayTotal) : null;
  const withCost = rows.filter((r) => isNum(r.cost) && isNum(r.value));
  const invested = withCost.reduce((a, r) => a + r.cost, 0);
  const gainTotal = withCost.reduce((a, r) => a + r.gain, 0);
  const gainPct = invested > 0 ? gainTotal / invested : null;
  const noCost = rows.filter((r) => r.s && !isNum(r.cost)).length;
  const isPerf = pfUi.view === 'perf';

  document.querySelectorAll('#pfViews [data-pfview]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.pfview === pfUi.view)));
  $('#pfViews').hidden = !rows.length;

  const wavg = (key) => {
    let num = 0, den = 0;
    rows.forEach((r) => { if (r.s && isNum(r.s[key]) && r.value) { num += r.s[key] * r.value; den += r.value; } });
    return den ? num / den : null;
  };
  const ranked = withCost.filter((r) => isNum(r.pct)).sort((a, b) => b.pct - a.pct);
  const best = ranked[0], worst = ranked[ranked.length - 1];
  const warnCount = rows.filter((r) => r.s && weakSignals(r.s).length).length;
  const etfShare = total ? rows.filter((r) => r.s && r.s.type === 'ETF').reduce((a, r) => a + (r.value || 0), 0) / total : 0;

  const stats = !rows.length ? '' : isPerf
    ? `<div class="pf-stats">
        <div><small>Investiert</small><b>${withCost.length ? money(invested, 0) : '–'}</b></div>
        <div><small>Positionen</small><b>${rows.length}</b></div>
        <div><small>Beste Position</small><b>${best ? `${esc(shortName(best.s))} <span class="up">${pct(best.pct, 0, true)}</span>` : '–'}</b></div>
        <div><small>Schwächste Position</small><b>${worst && worst !== best ? `${esc(shortName(worst.s))} <span class="${perfCls(worst.pct)}">${pct(worst.pct, 0, true)}</span>` : '–'}</b></div>
      </div>
      ${noCost ? `<p class="pf-miss">${noCost} ${noCost === 1 ? 'Position hat' : 'Positionen haben'} noch keine Kaufdaten und ${noCost === 1 ? 'fehlt' : 'fehlen'} in der Gesamtentwicklung – tippe bei der Position auf „Kaufdaten ergänzen“.</p>` : ''}`
    : `<div class="pf-stats">
        <div title="Wertgewichteter StockRatio-Score der Einzelaktien (ETFs ohne Score)"><small>Ø Score</small><b>${isNum(wavg('score')) ? NF[0].format(wavg('score')) : '–'}</b></div>
        <div><small>Mit Warnsignalen</small><b class="${warnCount ? 'down' : 'up'}">${warnCount} von ${rows.length}</b></div>
        <div><small>Ø vs. S&amp;P 500</small><b>${isNum(wavg('rel52')) ? pct(wavg('rel52'), 1, true, true) : '–'}</b></div>
        <div><small>Anteil ETFs</small><b>${pct(etfShare, 0)}</b></div>
      </div>`;

  $('#pfSummary').innerHTML = `
    <div class="pf-top">
      <h2>Mein Portfolio</h2>
      <div class="seg cur-seg" role="group" aria-label="Währung">
        ${['EUR', 'USD'].map((c) => `<button data-cur="${c}" aria-selected="${PF.cur === c}">${CUR_SIGN[c]} ${c}</button>`).join('')}
      </div>
    </div>
    <div class="pf-value">${money(total)}</div>
    ${rows.length ? `<div class="pf-perf">
        <div><small>Seit Kauf</small><b class="${perfCls(gainTotal)}">${withCost.length ? `${signed(gainTotal)} <span>${pct(gainPct, 2, true)}</span>` : '–'}</b></div>
        <div><small>Heute</small><b class="${perfCls(dayTotal)}">${isNum(dayPct) ? `${signed(dayTotal)} <span>${pct(dayPct, 2, true)}</span>` : '–'}</b></div>
      </div>` : '<div class="pf-day"><span class="muted">Noch keine Positionen</span></div>'}
    ${stats}`;

  $('#pfList').hidden = !isPerf && rows.length > 0;
  $('#pfScan').hidden = isPerf || !rows.length;

  if (!rows.length) {
    $('#pfList').innerHTML = `<div class="pf-empty card">
      <b>Dein Portfolio ist noch leer.</b>
      <p class="muted">Suche unten eine Aktie oder einen ETF, gib Kaufbetrag (oder Stückzahl), Kaufdatum und Kaufkurs ein und tippe auf „Hinzufügen“.
      Deine Favoriten kannst du direkt antippen.</p></div>`;
  } else if (isPerf) {
    $('#pfList').innerHTML = rows.map((r) => perfRowHtml(r, total)).join('') + `<div class="card pf-levels">${levelsSummaryHtml(rows)}</div>`;
  } else {
    renderPfScan();
  }
  renderPfForm();
}

function perfRowHtml({ p, s, value, gain, pct: pc }, total) {
  if (!s) {
    return `<div class="pf-row missing"><div class="pf-name"><div class="nm-wrap"><span class="nm">${esc(p.s)}</span>
      <span class="tk">Nicht mehr in den Daten – in watchlist.txt eintragen</span></div></div>
      <div class="pf-act"><button class="icon-btn" data-del="${esc(p.s)}" aria-label="Entfernen">✕</button></div></div>`;
  }
  const w = total && value ? value / total : 0;
  const since = p.buyDate ? `<span class="tk pf-date">Kauf ${dateDe(p.buyDate)}<span class="pf-hold"> · ${holdFor(p.buyDate)}</span></span>` : '';
  const perf = isNum(pc)
    ? `<span class="pf-gain ${perfCls(gain)}"><b>${pct(pc, 1, true)}</b> ${signed(gain)}</span>`
    : `<button class="link-btn" data-edit="${esc(s.s)}">Kaufdaten ergänzen</button>`;
  return `<div class="pf-row" data-sym="${esc(s.s)}" tabindex="0">
    <div class="pf-name">${logoHtml(s)}<div class="nm-wrap"><span class="nm">${esc(s.n)}</span>
      <span class="tk">${fmtShares(p.shares)} Stk.<span class="pf-pxi"> · ${priceFmt(s)}</span></span>${since}</div></div>
    <div class="pf-val"><b>${money(value)}</b>${perf}<span class="pf-wt">${pct(w, 0)} des Portfolios</span></div>
    <div class="pf-act"><button class="icon-btn" data-edit="${esc(s.s)}" aria-label="Bearbeiten" title="Bearbeiten">✎</button></div>
    ${levelRowHtml(p, s)}
  </div>`;
}

function renderPfScan() {
  const view = currentView();
  $('#pfMetricViews').innerHTML = VIEWS.map(([id, label, , short]) =>
    `<button role="tab" data-pfmetric="${id}" aria-selected="${state.view === id}"><span class="long">${label}</span><span class="short">${short || label}</span></button>`).join('');
  const cur = sortId(pfUi.sort.key, pfUi.sort.dir);
  const opts = PF_SORTS.map(([k, d, l]) => [sortId(k, d), l]);
  if (!opts.some(([id]) => id === cur) && COLUMNS[pfUi.sort.key]) opts.push([cur, `${COLUMNS[pfUi.sort.key].label} ${pfUi.sort.dir === 1 ? '↑' : '↓'}`]);
  $('#pfSortSel').innerHTML = opts.map(([id, l]) => `<option value="${id}" ${id === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');

  const stocks = sortRows(PF.positions.map((p) => BYSYM[p.s]).filter(Boolean), pfUi.sort);
  const warn = stocks.filter((s) => weakSignals(s).length).length;
  $('#pfScanCount').textContent = `${stocks.length} Positionen${warn ? ` · ${warn} mit ⚠` : ''}`;

  if (isMobile()) {
    $('#pfTable tbody').innerHTML = '';
    $('#pfCards').innerHTML = stocks.map((s) => cardHtml(s, pfCardExtra(s))).join('');
  } else {
    $('#pfCards').innerHTML = '';
    const cols = ['name', 'warn', 'pfVal', 'pfPct', ...view[2].filter((k) => k !== 'name')];
    $('#pfTable thead').innerHTML = headHtml(cols, pfUi.sort);
    $('#pfTable tbody').innerHTML = stocks.map((s) =>
      `<tr data-sym="${esc(s.s)}" tabindex="0" class="${weakSignals(s).length >= 2 ? 'row-warn' : ''}">${cols.map((k) => `<td class="${COLUMNS[k].cls || ''}">${COLUMNS[k].render(s)}</td>`).join('')}</tr>`).join('');
  }
}

function pfCardExtra(s) {
  const p = posOf(s.s);
  const r = p ? posPerf(p) : {};
  const w = weakSignals(s);
  const trend = p && isNum(p.refScore) && isNum(s.score) && p.refScore !== s.score
    ? ` · Score ${p.buyDate && p.refDate === p.buyDate ? 'seit Kauf' : `seit ${dateDe(p.refDate)}`} <b class="${s.score > p.refScore ? 'up' : 'down'}">${NF[0].format(p.refScore)} → ${NF[0].format(s.score)}</b>`
    : '';
  return `<div class="sc-pos">Position <b>${money(r.value, 0)}</b>${isNum(r.pct) ? ` <span class="${perfCls(r.pct)}">${pct(r.pct, 1, true)}</span>` : ''}${trend}</div>
    <div class="sc-warn">${w.length ? w.map((t) => `<span class="wchip">⚠ ${esc(t)}</span>`).join('') : '<span class="okchip">✓ Keine Warnsignale</span>'}</div>`;
}

function setPfView(v) {
  pfUi.view = v === 'scan' ? 'scan' : 'perf';
  store.set(PFVIEW_KEY, pfUi.view);
  renderPortfolio();
}

function renderPfForm() {
  const held = new Set(PF.positions.map((p) => p.s));
  const quick = [...favs].filter((sym) => BYSYM[sym] && !held.has(sym));
  $('#pfQuick').innerHTML = !pf.editing && quick.length
    ? `<span class="muted">Aus Favoriten:</span>${quick.map((sym) => `<button class="chip" data-pick="${esc(sym)}">${esc(shortName(BYSYM[sym]))}</button>`).join('')}`
    : '';
  const s = pf.sel ? BYSYM[pf.sel] : null;
  $('#pfSelected').hidden = !s;
  $('#pfSelected').innerHTML = s
    ? `<div class="sg-name">${logoHtml(s, 'sm')}<div><b>${esc(s.n)}</b><span class="tk">${esc(s.s)}${s.type === 'ETF' ? ' · ETF' : ''} · aktuell ${priceFmt(s)}${PF.cur !== majorOf(s.cur) && isNum(priceIn(s)) ? ` ≈ ${money(priceIn(s))}` : ''}</span></div></div>
       ${pf.editing ? '' : '<button class="icon-btn" id="pfClear" aria-label="Auswahl entfernen">✕</button>'}`
    : '';
  $('#pfFormTitle').textContent = pf.editing ? 'Position bearbeiten' : 'Position hinzufügen';
  $('#pfSave').textContent = pf.editing ? 'Speichern' : 'Hinzufügen';
  $('#pfCancel').hidden = !pf.editing;
  $('#pfDelete').hidden = !pf.editing;
  $('#pfSearch').parentElement.hidden = !!pf.editing;
  $('#pfMode').options[0].textContent = `Kaufbetrag in ${CUR_SIGN[PF.cur]}`;
  $('#pfAmountLabel').textContent = $('#pfMode').value === 'shares' ? 'Stückzahl' : `Betrag (${CUR_SIGN[PF.cur]})`;
  $('#pfAmount').placeholder = $('#pfMode').value === 'shares' ? 'z. B. 12,5' : 'z. B. 2.500';
  $('#pfPxLabel').textContent = `Kaufkurs je Aktie${s ? ` (${s.cur})` : ''}`;
  $('#pfPx').placeholder = s && isNum(s.px) ? `aktuell ${NF[s.px >= 1000 ? 0 : 2].format(s.px)}` : 'aktueller Kurs';
  $('#pfDate').max = todayIso();
  pf.lastMode = $('#pfMode').value;
  updatePfHint();
}

const majorOf = (cur) => (MINOR_CUR[cur] || [cur])[0];
const shortName = (s) => (s.n || s.s).replace(/,? (Inc\.?|Corporation|Corp\.?|Holdings?|N\.V\.|AG|SE|plc|Ltd\.?|Limited|S\.A\.)$/i, '').slice(0, 28);

// reads the form: shares, average buy price (stock currency), date and cost in EUR + USD
function pfInputs() {
  const s = pf.sel ? BYSYM[pf.sel] : null;
  const amount = parseAmount($('#pfAmount').value);
  const pxTyped = parseAmount($('#pfPx').value);
  const buyPx = pxTyped || (s ? s.px : null);
  const date = $('#pfDate').value || todayIso();
  if (!s || !amount || !isNum(buyPx)) return { s, ok: false };
  const unit = usdPerUnit(s.cur), unitPf = usdPerUnit(PF.cur), eurRate = usdPerUnit('EUR');
  if (!unit || !unitPf || !eurRate) return { s, ok: false, noFx: true };
  const shares = $('#pfMode').value === 'shares' ? amount : (amount * unitPf) / (buyPx * unit);
  const costUsd = shares * buyPx * unit;
  return { s, ok: true, shares, buyPx, date, pxTyped: !!pxTyped, cost: { USD: costUsd, EUR: costUsd / eurRate } };
}

function updatePfHint() {
  const r = pfInputs();
  let hint = '';
  if (r.ok) {
    const value = r.shares * priceIn(r.s);
    const cost = r.cost[PF.cur];
    const g = value - cost;
    hint = `= ${fmtShares(r.shares)} Stück für ${money(cost)} · heute ${money(value)} (${pct(g / cost, 1, true)})`
      + (r.pxTyped ? '' : ' · ohne Kaufkurs zählt der aktuelle Kurs');
  } else if (r.noFx) {
    hint = 'Für diese Währung fehlt ein Wechselkurs – bitte morgen erneut versuchen.';
  } else if (!r.s) {
    hint = 'Wähle zuerst eine Aktie oder einen ETF aus.';
  }
  $('#pfHint').textContent = hint;
  $('#pfSave').disabled = !r.ok;
}

function pickForPortfolio(sym) {
  pf.sel = sym;
  const existing = posOf(sym);
  if (existing) { startEdit(sym); return; }
  $('#pfSearch').value = '';
  $('#pfSuggest').hidden = true;
  $('#pfDate').value = todayIso();
  $('#pfPx').value = '';
  renderPfForm();
  $('#pfAmount').focus();
}

const decStr = (v, d = 4) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: d, useGrouping: false }).format(v);

function startEdit(sym) {
  if (!BYSYM[sym]) return;
  if (state.mode !== 'portfolio') setMode('portfolio');
  const existing = posOf(sym);
  pf.sel = sym;
  pf.editing = existing ? sym : null;
  $('#pfMode').value = existing ? 'shares' : 'cost';
  $('#pfAmount').value = existing ? decStr(existing.shares) : '';
  $('#pfDate').value = existing && existing.buyDate ? existing.buyDate : todayIso();
  $('#pfPx').value = existing && isNum(existing.buyPx) ? decStr(existing.buyPx, existing.buyPx >= 1000 ? 2 : 4) : '';
  renderPfForm();
  $('#pfForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => $((existing && !isNum(existing.buyPx)) ? '#pfPx' : '#pfAmount').focus({ preventScroll: true }), 300);
}

function resetPfForm() {
  pf.sel = null; pf.editing = null;
  $('#pfAmount').value = ''; $('#pfSearch').value = ''; $('#pfPx').value = ''; $('#pfDate').value = '';
  $('#pfMode').value = 'cost';
  $('#pfSuggest').hidden = true;
  renderPfForm();
}

function savePosition() {
  const r = pfInputs();
  if (!r.ok) return;
  const { s } = r;
  const fields = { shares: r.shares, buyPx: r.buyPx, buyDate: r.date, cost: r.cost };
  const existing = posOf(s.s);
  if (existing) Object.assign(existing, fields);
  else PF.positions.push({ s: s.s, ...fields, refScore: isNum(s.score) ? s.score : undefined, refDate: r.date });
  savePF();
  toast(existing ? `${shortName(s)} aktualisiert` : `${shortName(s)} hinzugefügt`);
  resetPfForm();
  renderPortfolio();
}

function deletePosition(sym) {
  const s = BYSYM[sym];
  if (!confirm(`${s ? s.n : sym} aus dem Portfolio entfernen?`)) return;
  PF.positions = PF.positions.filter((p) => p.s !== sym);
  savePF();
  if (pf.editing === sym) resetPfForm();
  renderPortfolio();
}

// adds a purchase to the portfolio (Kaufplan) – merges into an existing position with an average price
function addPurchase(sym, shares, px, date, cost) {
  const s = BYSYM[sym];
  const existing = posOf(sym);
  if (!existing) {
    PF.positions.push({ s: sym, shares, buyPx: px, buyDate: date, cost, refScore: s && isNum(s.score) ? s.score : undefined, refDate: date });
    return;
  }
  const hadData = isNum(existing.buyPx);
  const total = existing.shares + shares;
  if (hadData) {
    const oldCost = existing.cost || { EUR: null, USD: null };
    existing.buyPx = (existing.shares * existing.buyPx + shares * px) / total;
    existing.cost = {
      EUR: isNum(oldCost.EUR) ? oldCost.EUR + cost.EUR : null,
      USD: isNum(oldCost.USD) ? oldCost.USD + cost.USD : null,
    };
    if (!isNum(existing.cost.EUR)) delete existing.cost;
    if (!existing.buyDate || date < existing.buyDate) existing.buyDate = date;
  }
  existing.shares = total;
}

function suggest(query) {
  const q = query.trim().toLowerCase();
  const box = $('#pfSuggest');
  if (q.length < 1) { box.hidden = true; return; }
  const scoreOf = (s) => {
    const sym = s.s.toLowerCase(), name = (s.n || '').toLowerCase();
    if (sym === q || (s.isin || '').toLowerCase() === q) return 0;
    if (sym.startsWith(q)) return 1;
    if (name.startsWith(q)) return 2;
    if (name.includes(q) || sym.includes(q)) return 3;
    return 9;
  };
  const hits = STOCKS.map((s) => [scoreOf(s), s]).filter((x) => x[0] < 9)
    .sort((a, b) => a[0] - b[0] || (b[1].mcap || 0) - (a[1].mcap || 0)).slice(0, 8);
  box.innerHTML = hits.length
    ? hits.map(([, s]) => `<li role="option" data-pick="${esc(s.s)}"><span class="sg-name">${logoHtml(s, 'sm')}<span><b>${esc(s.n)}</b><span class="tk">${esc(s.s)}${s.type === 'ETF' ? ' · ETF' : ''}</span></span></span><span class="tk">${priceFmt(s)}</span></li>`).join('')
    : '<li class="muted">Nichts gefunden – nur Werte aus S&amp;P 500, MSCI World und watchlist.txt sind verfügbar.</li>';
  box.hidden = false;
}

function bindPortfolio() {
  $('#modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) setMode(b.dataset.mode);
  });
  $('#pfSummary').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cur]');
    if (!b) return;
    PF.cur = b.dataset.cur;
    savePF();
    renderPortfolio();
  });
  $('#pfViews').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pfview]');
    if (b) setPfView(b.dataset.pfview);
  });
  $('#pfMetricViews').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pfmetric]');
    if (!b) return;
    state.view = b.dataset.pfmetric;
    renderPfScan();
    writeHash();
  });
  $('#pfSortSel').addEventListener('change', (e) => {
    const v = e.target.value, key = v.slice(0, -1);
    if (COLUMNS[key]) pfUi.sort = { key, dir: v.endsWith('+') ? 1 : -1 };
    renderPfScan();
  });
  $('#pfTable thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (pfUi.sort.key === key) pfUi.sort.dir *= -1;
    else pfUi.sort = { key, dir: COLUMNS[key].dir || -1 };
    renderPfScan();
  });
  $('#pfDelete').addEventListener('click', () => { if (pf.editing) deletePosition(pf.editing); });
  $('#pfDate').addEventListener('change', updatePfHint);
  $('#pfPx').addEventListener('input', updatePfHint);
  $('#pfPx').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePosition(); });
  let t;
  $('#pfSearch').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => suggest(e.target.value), 80); });
  $('#pfSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = $('#pfSuggest [data-pick]'); if (first) pickForPortfolio(first.dataset.pick); }
    if (e.key === 'Escape') $('#pfSuggest').hidden = true;
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.pf-search')) $('#pfSuggest').hidden = true; });
  $('#portfolioView').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { pickForPortfolio(pick.dataset.pick); return; }
    if (e.target.closest('#pfClear')) { resetPfForm(); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) { startEdit(edit.dataset.edit); return; }
    const del = e.target.closest('[data-del]');
    if (del) { deletePosition(del.dataset.del); return; }
    const fav = e.target.closest('#pfScan [data-fav]');
    if (fav) {
      toggleFav(fav.dataset.fav);
      renderPresets();
      return;
    }
    const row = e.target.closest('.pf-row[data-sym], #pfScan [data-sym]');
    if (row) openDetail(row.dataset.sym);
  });
  $('#portfolioView').addEventListener('keydown', (e) => {
    const row = e.target.closest('.pf-row[data-sym], #pfScan .scard[data-sym], #pfScan tr[data-sym]');
    if (row && e.key === 'Enter') openDetail(row.dataset.sym);
  });
  $('#pfAmount').addEventListener('input', updatePfHint);
  $('#pfAmount').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePosition(); });
  $('#pfMode').addEventListener('change', () => {
    // keep the meaning: convert the number (computed with the previous mode) when switching amount <-> shares
    const now = $('#pfMode').value;
    $('#pfMode').value = pf.lastMode || 'cost';
    const r = pfInputs();
    $('#pfMode').value = now;
    if (r.ok) $('#pfAmount').value = now === 'shares' ? decStr(r.shares, 6) : decStr(r.cost[PF.cur], 2);
    renderPfForm();
  });
  $('#pfSave').addEventListener('click', savePosition);
  $('#pfCancel').addEventListener('click', resetPfForm);
  $('#pfTransfer').addEventListener('click', shareTransferLink);
}

/* transfer portfolio + favourites to another device via a link */
function shareTransferLink() {
  const payload = { v: 1, f: [...favs], p: PF, l: LEVELS.items, k: vapid };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const url = `${location.origin}${location.pathname}#import=${encodeURIComponent(b64)}`;
  const text = 'StockRatio: Portfolio & Favoriten übernehmen';
  if (navigator.share && isMobile()) {
    navigator.share({ title: text, url }).catch(() => {});
    return;
  }
  const done = () => toast('Link kopiert – öffne ihn auf dem anderen Gerät.');
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Diesen Link auf dem anderen Gerät öffnen:', url));
  else prompt('Diesen Link auf dem anderen Gerät öffnen:', url);
}

function readImportLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  const raw = params.get('import');
  if (!raw) return false;
  history.replaceState(null, '', location.pathname + location.search + '#m=pf');
  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(raw))));
    if (!payload || !Array.isArray(payload.f) || !payload.p) throw new Error('format');
    if (!confirm('Portfolio und Favoriten aus dem Link übernehmen? Die Daten auf diesem Gerät werden ersetzt.')) return false;
    favs.clear(); payload.f.forEach((x) => favs.add(String(x)));
    store.set(FAV_KEY, [...favs]);
    PF.cur = payload.p.cur === 'USD' ? 'USD' : 'EUR';
    PF.positions = (payload.p.positions || [])
      .filter((p) => p && typeof p.s === 'string' && isNum(p.shares) && p.shares > 0)
      .map((p) => ({ s: p.s, shares: p.shares }));
    savePF();
    if (payload.l && typeof payload.l === 'object') { LEVELS.items = payload.l; saveLevels(); }
    if (payload.k && typeof payload.k.pub === 'string') { vapid = payload.k; store.set(VAPID_KEY, vapid); }
    return true;
  } catch {
    alert('Der Übertragungs-Link ist ungültig.');
    return false;
  }
}

let toastTimer;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------------------------------------------------------------- Kaufplan */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;
const eur = (v, d = 2) => (isNum(v)
  ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }).format(v)
  : '–');

// Attractiveness used for the smart split (0–100)
function attractiveness(s) {
  if (isNum(s.score)) return s.score;
  return s.type === 'ETF' ? 60 : 40;
}

// Weights with caps: max 40 % (70 % / 50 % for 2 / 3 positions), min 5 %
function planWeights(stocks, mode) {
  const n = stocks.length;
  if (!n) return [];
  const raw = stocks.map((s) => {
    if (mode === 'equal') return 1;
    // score dominates (squared); high volatility trims the weight by at most 10 %
    const a = Math.max(attractiveness(s), 5) / 100;
    const beta = isNum(s.beta) ? clamp(s.beta, 0.8, 2.0) : 1;
    return a * a * (1 - 0.1 * (beta - 1));
  });
  if (mode === 'equal' || n === 1) return raw.map((x) => x / raw.reduce((a, b) => a + b, 0));
  const maxW = n === 2 ? 0.7 : n === 3 ? 0.5 : 0.4;
  const minW = Math.min(0.05, 0.5 / n);
  const fixed = new Array(n).fill(null);
  let w = [];
  for (let iter = 0; iter < 25; iter += 1) {
    const fixedTotal = fixed.reduce((a, f) => a + (f ?? 0), 0);
    const freeRaw = raw.reduce((a, x, i) => a + (fixed[i] === null ? x : 0), 0);
    w = raw.map((x, i) => fixed[i] ?? (freeRaw ? (x / freeRaw) * (1 - fixedTotal) : 0));
    let changed = false;
    w.forEach((x, i) => {
      if (fixed[i] !== null) return;
      if (x > maxW + 1e-9) { fixed[i] = maxW; changed = true; } else if (x < minW - 1e-9) { fixed[i] = minW; changed = true; }
    });
    if (!changed) break;
  }
  return w;
}

// Take profit / stop loss in the stock's trading currency
function tpsl(s) {
  if (!isNum(s.px)) return null;
  const hasBeta = isNum(s.beta) && s.beta > 0;
  const slPct = hasBeta ? clamp(0.08 * s.beta, 0.06, 0.2) : (s.type === 'ETF' ? 0.07 : 0.1);
  const sl = s.px * (1 - slPct);
  let tp, src;
  const up = isNum(s.tgt) ? s.tgt / s.px - 1 : null; // from the current price, not the stored upside
  if (isNum(up) && s.nA >= 3 && up >= 1.5 * slPct && up <= 0.8) {
    tp = s.tgt; src = `Kursziel von ${s.nA} Analysten`;
  } else {
    tp = s.px * (1 + 2.5 * slPct); src = 'Chance/Risiko 2,5 : 1';
  }
  const b = broker();
  if (b.cap !== null && tp > s.px * (1 + b.cap)) {
    tp = s.px * (1 + b.cap);
    src = `${src} – gekappt auf ${b.name}-Grenze`;
  }
  return { sl, slPct, tp, tpPct: tp / s.px - 1, src, crv: (tp - s.px) / (s.px - sl), slSrc: hasBeta ? `Beta ${NF[2].format(s.beta)}` : 'Standard' };
}

function computePlan() {
  const budget = PLAN.budget || 0;
  const rows = PLAN.items.map((it) => ({ it, s: BYSYM[it.s], amount: 0 }));
  if (PLAN.frozen) {
    rows.forEach((r) => {
      r.amount = r.it.status === 'bought' ? (r.it.inv ?? r.it.amt ?? 0) : r.it.status === 'skipped' ? 0 : (r.it.amt ?? 0);
      r.planned = r.it.amt ?? 0;
      r.unplanned = r.it.amt === undefined && r.it.status === 'open';
    });
  } else {
    const invested = rows.filter((r) => r.it.status === 'bought').reduce((a, r) => a + (r.it.inv || 0), 0);
    const pool = Math.max(0, budget - invested);
    const active = rows.filter((r) => r.it.status === 'open' && r.s);
    const w = planWeights(active.map((r) => r.s), PLAN.mode);
    active.forEach((r, i) => { r.amount = round2(pool * w[i]); });
    if (active.length) { // put the rounding cent(s) on the largest position so the total matches exactly
      const diff = round2(pool - active.reduce((a, r) => a + r.amount, 0));
      const top = active.reduce((a, r) => (r.amount > a.amount ? r : a));
      top.amount = round2(top.amount + diff);
    }
    rows.forEach((r) => {
      if (r.it.status === 'bought') r.amount = r.it.inv || 0;
      r.planned = r.amount;
    });
  }
  const invested = rows.filter((r) => r.it.status === 'bought').reduce((a, r) => a + (r.it.inv || 0), 0);
  const open = rows.filter((r) => r.it.status === 'open').reduce((a, r) => a + r.amount, 0);
  const skipped = rows.filter((r) => r.it.status === 'skipped').reduce((a, r) => a + (r.planned || 0), 0);
  return { rows, budget, invested, open, skipped, rest: Math.max(0, budget - invested - open) };
}

function freezePlan(auto = false) {
  if (PLAN.frozen) return;
  const { rows } = computePlan();
  rows.forEach((r) => { if (r.it.status !== 'bought') r.it.amt = r.amount; else r.it.amt = r.it.amt ?? r.it.inv; });
  PLAN.frozen = true;
  savePlan();
  if (auto) toast('❄ Aufteilung eingefroren – die Beträge ändern sich jetzt nicht mehr.');
}

function unfreezePlan() {
  PLAN.frozen = false;
  PLAN.items.forEach((it) => { if (it.status !== 'bought') delete it.amt; });
  savePlan();
}

function togglePlan(sym) {
  if (!BYSYM[sym]) return;
  if (inPlan(sym)) {
    PLAN.items = PLAN.items.filter((i) => i.s !== sym);
    toast(`${shortName(BYSYM[sym])} aus dem Kaufplan entfernt`);
  } else {
    PLAN.items.push({ s: sym, status: 'open' });
    toast(PLAN.frozen
      ? `${shortName(BYSYM[sym])} hinzugefügt – Aufteilung ist eingefroren (zum Neuverteilen „Auftauen“)`
      : `${shortName(BYSYM[sym])} zum Kaufplan hinzugefügt`);
  }
  if (!PLAN.items.length) { PLAN.frozen = false; }
  savePlan();
  refreshPlanUi();
}

function refreshPlanUi() {
  const n = PLAN.items.length;
  const badge = $('#planCount');
  badge.hidden = n === 0;
  badge.textContent = n;
  document.querySelectorAll('[data-plan]').forEach((b) => {
    const on = inPlan(b.dataset.plan);
    b.classList.toggle('on', on);
    b.textContent = planBtnLabel(on, !!b.dataset.long);
    b.title = on ? 'Im Kaufplan' : 'Zum Kaufplan';
    b.setAttribute('aria-label', on ? 'Aus dem Kaufplan entfernen' : 'Zum Kaufplan hinzufügen');
  });
  if ($('#plan').open) renderPlan();
}

function renderPlan() {
  const P = computePlan();
  const budgetIn = $('#planBudget');
  if (document.activeElement !== budgetIn) {
    budgetIn.value = PLAN.budget ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(PLAN.budget) : '';
  }
  budgetIn.disabled = PLAN.frozen;
  $('#planMode').value = PLAN.mode;
  $('#planMode').disabled = PLAN.frozen;
  $('#planBroker').innerHTML = brokerSelect();
  $('#planTitle').textContent = `Kaufplan${PLAN.items.length ? ` (${PLAN.items.length})` : ''}`;

  $('#planFreeze').innerHTML = PLAN.items.length
    ? (PLAN.frozen
      ? `<div class="freeze-on"><span>❄ <b>Aufteilung eingefroren</b> – Beträge bleiben fest, Ausgelassenes wird nicht investiert.</span>
          <button class="btn ghost" data-plan-act="unfreeze">Auftauen</button></div>`
      : `<div class="freeze-off"><span>Die Aufteilung passt sich an, wenn du Aktien hinzufügst oder entfernst.</span>
          <button class="btn" data-plan-act="freeze" ${PLAN.budget ? '' : 'disabled'}>❄ Einfrieren</button></div>`)
    : '';

  const seg = (v) => (P.budget ? (v / P.budget) * 100 : 0);
  $('#planSummary').innerHTML = PLAN.items.length && P.budget ? `
    <div class="ps-bar">
      <i class="ps-inv" style="width:${seg(P.invested)}%"></i><i class="ps-open" style="width:${seg(P.open)}%"></i>
    </div>
    <div class="ps-grid">
      <div><small><i class="dot ps-inv"></i>Gekauft</small><b>${eur(P.invested)}</b></div>
      <div><small><i class="dot ps-open"></i>Noch offen</small><b>${eur(P.open)}</b></div>
      <div><small><i class="dot ps-rest"></i>Nicht investiert</small><b>${eur(P.rest)}</b></div>
    </div>` : '';

  $('#planList').innerHTML = PLAN.items.length ? P.rows.map((r) => planItemHtml(r, P)).join('') : `
    <div class="plan-empty">
      <div class="pe-icon">+</div>
      <b>Noch keine Aktien im Kaufplan</b>
      <p class="muted">Tippe im Screener, in deinen Favoriten oder in der Detailansicht auf <span class="plus demo">+</span>,
        um Aktien oder ETFs hier zu sammeln. Dann gibst du oben den Betrag ein, und die Seite schlägt eine Aufteilung vor.</p>
    </div>`;

  const bought = PLAN.items.filter((i) => i.status === 'bought' && (i.inv || 0) > 0);
  const boughtSum = bought.reduce((a, i) => a + i.inv, 0);
  $('#planFoot').innerHTML = PLAN.items.length ? `
    <button class="btn ghost" data-plan-act="clear">Liste leeren</button>
    <button class="btn primary" data-plan-act="commit" ${bought.length ? '' : 'disabled'}>
      ${bought.length ? `OK – ${bought.length} ${bought.length === 1 ? 'Kauf' : 'Käufe'} (${eur(boughtSum, 0)}) ins Portfolio` : 'OK – ins Portfolio'}
    </button>` : '';
}

function planItemHtml(r, P) {
  const { it, s } = r;
  if (!s) {
    return `<div class="pl-item missing"><div class="pl-head"><div class="pl-name"><b>${esc(it.s)}</b>
      <span class="tk">Nicht mehr in den Daten</span></div><button class="icon-btn" data-plan-del="${esc(it.s)}" aria-label="Entfernen">✕</button></div></div>`;
  }
  const t = tpsl(s);
  const priceEur = priceIn(s, 'EUR');
  const pctOfBudget = P.budget ? r.amount / P.budget : 0;
  const shares = priceEur && r.amount ? r.amount / priceEur : null;
  const scoreHtml = isNum(s.score)
    ? `<span class="pill lv-${s.label}"><span class="score-num">${NF[0].format(s.score)}</span><span class="lbl">${esc(s.label)}</span></span>`
    : s.type === 'ETF' ? '<span class="badge b-etf">ETF</span>' : '';
  const pxD = (v) => `${NF[v >= 1000 ? 0 : 2].format(v)} ${esc(s.cur || '')}`;
  const status = it.status;

  let alloc;
  if (status === 'skipped') {
    alloc = `<div class="pl-alloc"><span class="pl-amt muted">Ausgelassen</span><span class="tk">${eur(r.planned)} bleiben uninvestiert</span></div>`;
  } else if (r.unplanned) {
    alloc = `<div class="pl-alloc"><span class="pl-amt muted">Nicht eingeplant</span><span class="tk">Nach dem Einfrieren hinzugefügt – „Auftauen“ verteilt neu</span></div>`;
  } else {
    alloc = `<div class="pl-alloc">
      <span class="pl-pct">${P.budget ? NF[1].format(pctOfBudget * 100) + ' %' : '–'}</span>
      <span class="pl-amt">${P.budget ? eur(r.amount) : 'Betrag eingeben'}</span>
      <span class="tk">${shares ? `≈ ${fmtShares(shares)} Stk. à ${priceFmt(s)}` : priceFmt(s)}</span>
    </div>
    <div class="bar pl-bar"><i style="width:${(pctOfBudget * 100).toFixed(1)}%"></i></div>`;
  }

  const risk = t ? `<div class="pl-risk">
      <div><small>Take Profit</small><b>${pxD(t.tp)}</b><span class="up">+${NF[1].format(t.tpPct * 100)} %</span><em>${esc(t.src)}</em></div>
      <div><small>Stop Loss</small><b>${pxD(t.sl)}</b><span class="down">−${NF[1].format(t.slPct * 100)} %</span><em>${esc(t.slSrc)}</em></div>
      <div><small>Chance/Risiko</small><b>${NF[1].format(t.crv)} : 1</b><em>Kurs ${pxD(s.px)}</em></div>
    </div>` : '';

  let actions;
  if (status === 'bought') {
    actions = `<div class="pl-actions done"><span class="pl-done">✓ Gekauft – investiert</span>
      <span class="pl-inv"><input type="text" inputmode="decimal" data-plan-inv="${esc(s.s)}" value="${NF[2].format(it.inv || 0).replace(/\./g, '')}" aria-label="Investierter Betrag"><b>€</b></span>
      <button class="btn ghost" data-plan-undo="${esc(s.s)}">Rückgängig</button></div>`;
  } else if (status === 'skipped') {
    actions = `<div class="pl-actions"><button class="btn ghost" data-plan-undo="${esc(s.s)}">Rückgängig</button></div>`;
  } else {
    const can = P.budget && r.amount > 0;
    actions = `<div class="pl-actions">
      <button class="btn primary" data-plan-buy="${esc(s.s)}" ${can ? '' : 'disabled'}>✓ Gekauft</button>
      <button class="btn" data-plan-skip="${esc(s.s)}" ${P.budget ? '' : 'disabled'}>Auslassen</button></div>`;
  }

  return `<div class="pl-item st-${status}">
    <div class="pl-head">
      <div class="pl-name" data-plan-open="${esc(s.s)}">${logoHtml(s)}<div class="nm-wrap"><b>${esc(s.n)}</b><span class="tk">${esc(s.s)} ${scoreHtml}</span></div></div>
      <button class="icon-btn" data-plan-del="${esc(s.s)}" aria-label="Aus dem Kaufplan entfernen" title="Entfernen">✕</button>
    </div>
    ${alloc}
    ${status === 'skipped' ? '' : risk}
    ${actions}
  </div>`;
}

function commitPlan() {
  const bought = PLAN.items.filter((i) => i.status === 'bought' && (i.inv || 0) > 0 && BYSYM[i.s]);
  if (!bought.length) return;
  const sum = bought.reduce((a, i) => a + i.inv, 0);
  const missing = bought.filter((i) => !priceIn(BYSYM[i.s], 'EUR'));
  if (missing.length) { alert('Für einige Werte fehlt der Wechselkurs – bitte später erneut versuchen.'); return; }
  const openLeft = PLAN.items.filter((i) => i.status === 'open').length;
  const msg = `${bought.length} ${bought.length === 1 ? 'Kauf' : 'Käufe'} über ${eur(sum)} ins Portfolio übernehmen?\n\n`
    + 'Bestehende Positionen werden um die neuen Stücke ergänzt, nichts wird überschrieben.'
    + (openLeft ? `\n${openLeft} noch offene Position(en) bleiben im Kaufplan.` : '\nDer Kaufplan wird danach geleert.');
  if (!confirm(msg)) return;
  bought.forEach((i) => {
    setLevel(i.s);
    const st = BYSYM[i.s];
    const shares = i.inv / priceIn(st, 'EUR');
    addPurchase(i.s, shares, st.px, todayIso(), { EUR: i.inv, USD: i.inv * usdPerUnit('EUR') });
  });
  savePF();
  saveLevels();
  const remaining = PLAN.items.filter((i) => i.status === 'open');
  if (remaining.length) {
    PLAN.items = remaining;
    PLAN.budget = PLAN.frozen ? round2(remaining.reduce((a, i) => a + (i.amt || 0), 0)) : Math.max(0, round2((PLAN.budget || 0) - sum));
  } else {
    PLAN.items = []; PLAN.frozen = false; PLAN.budget = null;
  }
  savePlan();
  refreshPlanUi();
  if (state.mode === 'portfolio') renderPortfolio();
  toast(`${bought.length} ${bought.length === 1 ? 'Position' : 'Positionen'} ins Portfolio übernommen`);
}

function openPlan() {
  const dlg = $('#plan');
  renderPlan();
  if (!dlg.open) {
    dlg.showModal();
    history.pushState({ sr: 'plan' }, '');
  }
}

function bindPlan() {
  // "+" buttons anywhere (table, cards, detail) – capture phase so rows/cards don't open the detail view
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-plan]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    togglePlan(b.dataset.plan);
  }, true);

  $('#planOpen').addEventListener('click', openPlan);
  const dlg = $('#plan');
  dlg.addEventListener('close', () => { if (history.state && history.state.sr === 'plan') history.back(); });
  window.addEventListener('popstate', () => {
    if (dlg.open && !(history.state && (history.state.sr === 'plan' || history.state.sr === 'detail'))) dlg.close();
  });

  $('#planBudget').addEventListener('input', (e) => {
    PLAN.budget = parseAmount(e.target.value);
    savePlan();
    renderPlan();
  });
  $('#planBudget').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('#planMode').addEventListener('change', (e) => { PLAN.mode = e.target.value; savePlan(); renderPlan(); });

  dlg.addEventListener('change', (e) => {
    const inv = e.target.closest('[data-plan-inv]');
    if (!inv) return;
    const it = PLAN.items.find((i) => i.s === inv.dataset.planInv);
    const v = parseAmount(inv.value);
    if (it && v) { it.inv = round2(v); savePlan(); }
    renderPlan();
  });

  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-plan-close]')) { dlg.close(); return; }
    const el = (attr) => e.target.closest(`[${attr}]`);
    const item = (sym) => PLAN.items.find((i) => i.s === sym);
    let x;
    if ((x = el('data-plan-act'))) {
      const act = x.dataset.planAct;
      if (act === 'freeze') { freezePlan(); toast('❄ Aufteilung eingefroren'); }
      if (act === 'unfreeze') {
        const hasBought = PLAN.items.some((i) => i.status === 'bought');
        if (!hasBought || confirm('Aufteilung auftauen? Bereits gekaufte Beträge bleiben, der Rest des Budgets wird auf die offenen Positionen neu verteilt.')) unfreezePlan();
      }
      if (act === 'clear' && confirm('Kaufplan komplett leeren? Dein Portfolio bleibt unverändert.')) {
        PLAN.items = []; PLAN.frozen = false; savePlan(); refreshPlanUi();
      }
      if (act === 'commit') { commitPlan(); return; }
      renderPlan();
      return;
    }
    if ((x = el('data-plan-buy'))) {
      freezePlan(true);
      const it = item(x.dataset.planBuy);
      it.status = 'bought'; it.inv = it.amt ?? 0;
      savePlan(); renderPlan(); return;
    }
    if ((x = el('data-plan-skip'))) {
      freezePlan(true);
      item(x.dataset.planSkip).status = 'skipped';
      savePlan(); renderPlan(); return;
    }
    if ((x = el('data-plan-undo'))) {
      const it = item(x.dataset.planUndo);
      it.status = 'open'; delete it.inv;
      savePlan(); renderPlan(); return;
    }
    if ((x = el('data-plan-del'))) {
      const it = item(x.dataset.planDel);
      if (it && it.status === 'bought' && !confirm('Diese Position ist als gekauft markiert. Trotzdem entfernen? Sie wird dann nicht ins Portfolio übernommen.')) return;
      PLAN.items = PLAN.items.filter((i) => i.s !== x.dataset.planDel);
      if (!PLAN.items.length) PLAN.frozen = false;
      savePlan(); refreshPlanUi(); renderPlan(); return;
    }
    if ((x = el('data-plan-open'))) openDetail(x.dataset.planOpen);
  });
}

/* ---------------------------------------------------------------- portfolio TP / SL */

function setLevel(sym) {
  const s = BYSYM[sym];
  const t = s && tpsl(s);
  if (!t) return false;
  LEVELS.items[sym] = { tp: t.tp, sl: t.sl, px: s.px, cur: s.cur, src: t.src, slSrc: t.slSrc, at: new Date().toISOString() };
  return true;
}

// TP/SL distances + money impact for one position (portfolio currency)
function levelInfo(p, s) {
  const L = LEVELS.items[p.s];
  if (!L || !s || !isNum(s.px) || L.cur !== s.cur) return null;
  const perUnit = priceIn(s);               // price in portfolio currency
  const fx = perUnit !== null ? perUnit / s.px : null;
  const b = broker();
  // a stored target above the broker's limit (e.g. Revolut: 150 % of today's price) can't be placed – use the allowed maximum
  const capped = b.hard !== null && L.tp > s.px * (1 + b.hard);
  const tp = capped ? s.px * (1 + b.cap) : L.tp;
  return {
    L,
    tp,
    capped,
    tpPct: tp / s.px - 1,
    slPct: L.sl / s.px - 1,
    gain: fx !== null ? p.shares * (tp - s.px) * fx : null,
    loss: fx !== null ? p.shares * (L.sl - s.px) * fx : null,
    hitTp: s.px >= tp,
    hitSl: s.px <= L.sl,
    crv: s.px > L.sl ? (tp - s.px) / (s.px - L.sl) : null,
  };
}

const dateDe = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }); };
const signedMoney = (v) => (isNum(v) ? `${v >= 0 ? '+' : '−'}${money(Math.abs(v), 0)}` : '–');

function levelsSummaryHtml(rows) {
  const valid = rows.filter((r) => r.s);
  const withLv = valid.map((r) => ({ r, info: levelInfo(r.p, r.s) })).filter((x) => x.info);
  if (!withLv.length) {
    return `<div class="lv-bar empty">
      <div><b>Take Profit &amp; Stop Loss</b><p class="muted">Berechnet für jede Position ein Kursziel zum Gewinnmitnehmen und eine Verlustgrenze –
        ausgehend vom aktuellen Kurs. Die Werte werden gespeichert und bleiben fest, bis du sie neu generierst.</p></div>
      <div class="lv-gen">${brokerSelect()}<button class="btn primary" data-lv-act="generate">🎯 TP &amp; SL generieren</button></div>
    </div>`;
  }
  const gain = withLv.reduce((a, x) => a + (x.info.gain || 0), 0);
  const loss = withLv.reduce((a, x) => a + (x.info.loss || 0), 0);
  const hits = withLv.filter((x) => x.info.hitTp || x.info.hitSl).length;
  const missing = valid.length - withLv.length;
  const latest = withLv.map((x) => x.info.L.at).sort().pop();
  return `<div class="lv-bar">
    <div class="lv-head"><b>🎯 Take Profit &amp; Stop Loss</b><span class="muted">generiert am ${dateDe(latest)}</span></div>
    <div class="lv-sum">
      <div><small>Wenn alle Take Profits greifen</small><b class="up">${signedMoney(gain)}</b></div>
      <div><small>Wenn alle Stop Losses greifen</small><b class="down">${signedMoney(loss)}</b></div>
      <div><small>Chance/Risiko gesamt</small><b>${loss < 0 ? NF[1].format(gain / -loss) + ' : 1' : '–'}</b></div>
    </div>
    ${hits ? `<p class="lv-alert">⚠ Bei ${hits} ${hits === 1 ? 'Position ist' : 'Positionen ist'} ein Ziel erreicht – siehe unten.</p>` : ''}
    ${missing ? `<p class="muted lv-note">${missing} ${missing === 1 ? 'Position hat' : 'Positionen haben'} noch keine Werte – „Neu generieren“ ergänzt sie.</p>` : ''}
    ${withLv.some((x) => x.info.capped) ? `<p class="lv-alert">⚠ ${withLv.filter((x) => x.info.capped).length} gespeicherte Take Profit(s) lagen über der ${esc(broker().name)}-Grenze und wurden angepasst – „Alle neu generieren“ speichert die erlaubten Werte.</p>` : ''}
    <div class="lv-actions">
      ${brokerSelect()}
      <button class="btn" data-lv-act="generate">↻ Alle neu generieren</button>
      <button class="btn ghost" data-lv-act="copy">Liste kopieren</button>
      <button class="btn ghost" data-lv-act="clear">Entfernen</button>
    </div>
  </div>`;
}

function levelRowHtml(p, s) {
  const info = levelInfo(p, s);
  if (!info) return '';
  const { L } = info;
  const pxD = (v) => `${NF[v >= 1000 ? 0 : 2].format(v)} ${esc(s.cur || '')}`;
  const status = info.hitTp
    ? '<span class="lv-st hit-tp">🎯 Take Profit erreicht</span>'
    : info.hitSl
      ? '<span class="lv-st hit-sl">⚠ Stop Loss erreicht</span>'
      : `<span class="lv-st">CRV ${isNum(info.crv) ? NF[1].format(info.crv) + ' : 1' : '–'}</span>`;
  return `<div class="pf-lv">
    <div class="lv-tp" title="${esc(L.src || '')}"><small>Take Profit${info.capped ? ` <span class="lv-cap" title="Gespeichert: ${pxD(L.tp)} – über der ${esc(broker().name)}-Grenze von 150 % des Kurses">angepasst</span>` : ''}</small><b>${pxD(info.tp)}</b>
      <span class="${info.tpPct >= 0 ? 'up' : 'down'}">${pct(info.tpPct, 1, true)} · ${signedMoney(info.gain)}</span></div>
    <div class="lv-sl" title="${esc(L.slSrc || '')}"><small>Stop Loss</small><b>${pxD(L.sl)}</b>
      <span class="down">${pct(info.slPct, 1, true)} · ${signedMoney(info.loss)}</span></div>
    <div class="lv-meta">${status}<span class="tk">vom ${dateDe(L.at)} · Kurs damals ${pxD(L.px)}</span></div>
    <button class="icon-btn" data-lv-regen="${esc(s.s)}" aria-label="TP/SL für diese Position neu berechnen" title="Neu berechnen">↻</button>
  </div>`;
}

function copyLevels() {
  const lines = PF.positions.map((p) => {
    const s = BYSYM[p.s], L = LEVELS.items[p.s];
    if (!s || !L) return null;
    const f = (v) => `${NF[v >= 1000 ? 0 : 2].format(v)} ${s.cur}`;
    const info = levelInfo(p, s);
    return `${s.n} (${s.s}): Take Profit ${f(info ? info.tp : L.tp)} · Stop Loss ${f(L.sl)}`;
  }).filter(Boolean);
  const text = lines.join('\n');
  const done = () => toast('TP/SL-Liste kopiert');
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => prompt('TP/SL-Liste:', text));
  else prompt('TP/SL-Liste:', text);
}

function bindLevels() {
  document.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-broker]');
    if (!sel) return;
    SETTINGS.broker = BROKERS[sel.value] ? sel.value : 'revolut';
    store.set(SETTINGS_KEY, SETTINGS);
    if (state.mode === 'portfolio') renderPortfolio();
    if ($('#plan').open) renderPlan();
    toast(SETTINGS.broker === 'revolut' ? 'Take Profit max. +45 % (Revolut-Grenze)' : 'Ohne Broker-Grenze');
  });

  // capture phase so the buttons inside a portfolio row don't open the detail view
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-lv-act]');
    const regen = e.target.closest('[data-lv-regen]');
    if (!act && !regen) return;
    e.preventDefault();
    e.stopPropagation();
    if (regen) {
      if (setLevel(regen.dataset.lvRegen)) { saveLevels(); toast('Take Profit & Stop Loss neu berechnet'); }
    } else if (act.dataset.lvAct === 'generate') {
      const had = PF.positions.some((p) => LEVELS.items[p.s]);
      if (had && !confirm('Take Profit & Stop Loss für alle Positionen neu berechnen? Die bisherigen Werte werden ersetzt.')) return;
      const n = PF.positions.filter((p) => setLevel(p.s)).length;
      saveLevels();
      toast(`TP & SL für ${n} ${n === 1 ? 'Position' : 'Positionen'} generiert`);
    } else if (act.dataset.lvAct === 'copy') {
      copyLevels();
      return;
    } else if (act.dataset.lvAct === 'clear') {
      if (!confirm('Alle Take-Profit- und Stop-Loss-Werte entfernen? Deine Positionen bleiben unverändert.')) return;
      PF.positions.forEach((p) => { delete LEVELS.items[p.s]; });
      saveLevels();
    }
    renderPortfolio();
  }, true);
}

/* ---------------------------------------------------------------- settings & notifications */

// Push keys are generated on the user's device (Einstellungen → "Schlüssel erzeugen").
// Only the public key is stored; the private key is shown once to be saved as GitHub secret.
const VAPID_KEY = 'stockratio.push.vapid.v1';
let vapid = store.get(VAPID_KEY, null); // { pub, at }
let shownPrivateKey = null;             // kept in memory only, until the dialog is closed
const NOTIFY = Object.assign({}, (self.SRNotify || {}).DEFAULTS, store.get('stockratio.notify.v1', {}));
const saveNotify = () => store.set('stockratio.notify.v1', NOTIFY);
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let swReg = null;

const NOTIFY_OPTIONS = [
  ['down', 'Portfolio: starke Verschlechterung', 'z. B. von „Kaufen“ auf „Verkaufen“ oder Signal fällt um zwei Stufen (Positiv → Meiden)'],
  ['up', 'Portfolio: deutliche Verbesserung', 'z. B. eine Position wird neu zum Kaufkandidaten'],
  ['favs', 'Favoriten mit überwachen', 'Bewertungsänderungen auch für deine ★-Favoriten melden'],
  ['tpsl', 'Take Profit / Stop Loss erreicht', 'wenn der Kurs ein im Portfolio generiertes Ziel erreicht'],
  ['market', 'Markt: neue starke Kaufsignale', 'Aktien außerhalb deines Portfolios, die neu auf Score ≥ 90, Analysten „Kaufen“ und faire Bewertung steigen'],
  ['tradeday', 'Handelstage Mittwoch & Freitag', 'morgens (ca. 6:30 Uhr) eine Übersicht: Portfolio, Warnungen, Top-Kaufsignale, Kaufplan'],
];

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
  } catch { swReg = null; }
}

function repoInfo() {
  const gh = location.hostname.endsWith('.github.io');
  const owner = gh ? location.hostname.split('.')[0] : 'Ventrox9';
  const repo = gh ? (location.pathname.split('/')[1] || 'StockRatio') : 'StockRatio';
  return { owner, repo, base: `https://github.com/${owner}/${repo}` };
}

const bytesToB64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function generateKeys() {
  if (vapid && !confirm('Neue Schlüssel erzeugen? Danach müssen beide Secrets (VAPID_PRIVATE_KEY und PUSH_SUBSCRIPTIONS) auf GitHub neu eingetragen werden.')) return;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  vapid = { pub: bytesToB64(raw), at: new Date().toISOString() };
  store.set(VAPID_KEY, vapid);
  shownPrivateKey = jwk.d; // base64url, raw 32 bytes – the format the workflow expects
  const old = await currentSubscription();
  if (old) await old.unsubscribe().catch(() => {}); // the old subscription belongs to the old key
  renderSettings();
  await subscribePush();
}

async function subscribePush() {
  if (!vapid || !pushSupported() || Notification.permission !== 'granted') return false;
  const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
  try {
    const reg = await Promise.race([navigator.serviceWorker.ready, timeout(10000)]);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await Promise.race([
        reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapid.pub) }),
        timeout(20000),
      ]);
    }
    store.set('stockratio.push.sub', sub.toJSON());
    toast('Push-Verbindung hergestellt');
    return true;
  } catch {
    toast('Push-Verbindung gerade nicht möglich – Hinweise kommen beim Öffnen der Seite');
    return false;
  } finally {
    renderSettings();
  }
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch { return null; }
}

async function enableNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    alert('Dieser Browser unterstützt keine Benachrichtigungen. Nutze Chrome auf Android.');
    return;
  }
  let perm = Notification.permission;
  if (perm !== 'granted') perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    alert('Benachrichtigungen sind blockiert. In Chrome: Symbol links neben der Adresse → Berechtigungen → Benachrichtigungen → Zulassen. Danach erneut versuchen.');
    renderSettings();
    return;
  }
  NOTIFY.enabled = true;
  saveNotify();
  renderSettings(); // switches usable right away
  toast('Benachrichtigungen aktiviert');
  if (vapid) await subscribePush(); // push connection only once keys exist (see "Push einrichten")
}

async function disconnectPush() {
  const sub = await currentSubscription();
  if (sub) await sub.unsubscribe().catch(() => {});
  store.set('stockratio.push.sub', null);
  NOTIFY.enabled = false;
  saveNotify();
  toast('Gerät abgemeldet');
  renderSettings();
}

async function testNotification() {
  if (Notification.permission !== 'granted') { await enableNotifications(); if (Notification.permission !== 'granted') return; }
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('✅ StockRatio: Benachrichtigungen funktionieren', {
    body: 'So sehen Hinweise zu deinem Portfolio, neuen Kaufsignalen und Handelstagen aus.',
    icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'sr-test', data: { url: '#m=pf' },
  });
}

async function mirrorAll() {
  if (!self.SRNotify) return;
  const keys = ['stockratio.portfolio.v1', 'stockratio.favs.v2', 'stockratio.pf.levels.v1', 'stockratio.plan.v1', 'stockratio.notify.v1'];
  await Promise.all(keys.map((k) => SRNotify.idb.set(k, store.get(k, null)).catch(() => {})));
}

// on every visit: compare today's data with the last check (also works without push)
async function runLocalCheck() {
  if (!self.SRNotify || !('indexedDB' in self) || !DATA) return;
  try {
    await mirrorAll();
    const { notes } = await SRNotify.check(DATA, { type: 'update', via: 'app' });
    if (notes.length) {
      // show them like a push would – otherwise they would only land in the history
      let shown = false;
      if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        try { await SRNotify.display(await navigator.serviceWorker.ready, notes); shown = true; } catch { /* fall back to toast */ }
      }
      if (!shown) toast(`🔔 ${notes.length} neue${notes.length === 1 ? 'r Hinweis' : ' Hinweise'} – siehe Glocke oben`);
    }
    updateNotifyDot();
  } catch { /* storage not available */ }
}

async function updateNotifyDot() {
  try {
    const hist = (await SRNotify.idb.get('notify.history')) || [];
    const seen = store.get('stockratio.notify.seen', '');
    $('#notifyDot').hidden = !(hist[0] && hist[0].at > seen);
  } catch { /* ignore */ }
}

async function renderSettings() {
  const body = $('#settingsBody');
  const supported = pushSupported();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const sub = await currentSubscription();
  const active = NOTIFY.enabled && perm === 'granted';
  const hist = self.SRNotify ? ((await SRNotify.idb.get('notify.history').catch(() => [])) || []) : [];
  const { base } = repoInfo();
  const permTxt = { granted: '✓ erlaubt', denied: '✕ blockiert', default: 'noch nicht gefragt', unsupported: 'nicht unterstützt' }[perm];
  const fmt = (iso) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  body.innerHTML = `
    <section class="set-sec">
      <h3>🎨 Darstellung</h3>
      <div class="theme-list" role="radiogroup" aria-label="Farbschema">${themeOptionsHtml()}</div>
      <label class="sw"><input type="checkbox" data-logos ${logosOn() ? 'checked' : ''}><span class="sw-ui"></span>
        <span class="sw-txt"><b>Firmenlogos anzeigen</b><small>Logos werden von financialmodelingprep.com geladen (ersatzweise das Website-Symbol). Aus = Initialen.</small></span></label>
    </section>

    <section class="set-sec">
      <h3>🔔 Benachrichtigungen</h3>
      ${!supported ? '<p class="set-warn">Dieser Browser unterstützt keine Push-Benachrichtigungen. Auf Android funktioniert es mit Chrome.</p>' : ''}
      <div class="set-status">
        <div><small>Erlaubnis im Browser</small><b>${permTxt}</b></div>
        <div><small>Push-Verbindung</small><b>${sub ? '✓ verbunden' : '– nicht verbunden'}</b></div>
      </div>
      ${active ? `
        <label class="sw master"><input type="checkbox" data-nset="enabled" checked><span class="sw-ui"></span>
          <span class="sw-txt"><b>Benachrichtigungen an</b><small>Alle Hinweise vorübergehend aus- und wieder einschalten</small></span></label>`
      : `<button class="btn primary set-enable" data-set-act="enable" ${supported ? '' : 'disabled'}>🔔 Benachrichtigungen aktivieren</button>`}
      <div class="set-opts ${active ? '' : 'off'}">
        ${NOTIFY_OPTIONS.map(([k, t, d]) => `<label class="sw"><input type="checkbox" data-nset="${k}" ${NOTIFY[k] ? 'checked' : ''} ${active ? '' : 'disabled'}><span class="sw-ui"></span>
          <span class="sw-txt"><b>${t}</b><small>${d}</small></span></label>`).join('')}
      </div>
      ${active ? `<div class="set-row"><button class="btn" data-set-act="test">Test-Benachrichtigung</button>
        ${sub ? '<button class="btn ghost" data-set-act="disconnect">Gerät abmelden</button>' : ''}</div>` : ''}
    </section>

    <section class="set-sec">
      <h3>📲 Push auch bei geschlossener App (einmalige Einrichtung)</h3>
      <p class="muted">Damit dein Handy auch Hinweise bekommt, wenn die Seite geschlossen ist, schickt GitHub jeden Werktag morgens einen Weckruf.
        Die Prüfung selbst passiert auf deinem Gerät – dein Portfolio verlässt es nie. Ohne diese Einrichtung bekommst du die Hinweise beim Öffnen der Seite.</p>
      <ol class="set-steps">
        <li>Oben <b>„Benachrichtigungen aktivieren“</b> und erlauben.</li>
        <li>${vapid
          ? `Schlüssel vorhanden (erzeugt am ${new Date(vapid.at).toLocaleDateString('de-DE')}).
             <button class="btn ghost" data-set-act="keys">Neu erzeugen</button>`
          : `<button class="btn" data-set-act="keys" ${active ? '' : 'disabled'}>🔑 Schlüssel erzeugen</button>
             – entsteht auf diesem Gerät, niemand sonst sieht ihn.`}
          ${shownPrivateKey ? `<div class="key-box">
            <small>Privater Schlüssel – <b>nur jetzt sichtbar</b>. Als Secret <code>VAPID_PRIVATE_KEY</code> speichern:</small>
            <input type="text" readonly value="${esc(shownPrivateKey)}" aria-label="Privater Schlüssel">
            <div class="set-row"><button class="btn" data-set-act="copykey">Schlüssel kopieren</button>
            <a class="btn ghost" href="${base}/settings/secrets/actions/new" target="_blank" rel="noopener">Secret anlegen ↗</a></div>
          </div>` : ''}</li>
        <li><button class="btn" data-set-act="copy" ${sub ? '' : 'disabled'}>Abo-Code kopieren</button>
          und als Secret <code>PUSH_SUBSCRIPTIONS</code> speichern:
          <a href="${base}/settings/secrets/actions/new" target="_blank" rel="noopener">Secret anlegen ↗</a></li>
        <li>Testen: <a href="${base}/actions/workflows/notify.yml" target="_blank" rel="noopener">Actions → „Benachrichtigungen senden“ ↗</a>
          → <i>Run workflow</i> mit Typ <code>test</code>.</li>
      </ol>
      <p class="muted small">Kontrolle: Unter <a href="${base}/actions/workflows/notify.yml" target="_blank" rel="noopener">Actions → „Benachrichtigungen senden“ ↗</a>
        ist jeder Lauf grün, der wirklich gesendet hat – rot heißt: Secrets fehlen oder der Abo-Code ist abgelaufen.
        Im Verlauf unten steht bei jedem Hinweis, ob er <b>per Push</b> oder <b>beim Öffnen der App</b> kam.</p>
      <p class="muted small">Mehrere Geräte: Codes als Liste eintragen – <code>[Code1, Code2]</code>. Nach „Gerät abmelden“ entsteht beim nächsten Aktivieren ein neuer Code.</p>
    </section>

    <section class="set-sec">
      <h3>🕑 Verlauf</h3>
      ${hist.length ? `<ul class="set-hist">${hist.slice(0, 12).map((h) => `<li><a href="${esc(h.url || '#')}" data-set-close-link><b>${esc(h.title)}</b><span>${esc(h.body)}</span><small>${fmt(h.at)}${h.via === 'push' ? ' · per Push' : h.via === 'app' ? ' · beim Öffnen der App' : ''}</small></a></li>`).join('')}</ul>`
      : '<p class="muted">Noch keine Hinweise. Die erste Prüfung legt den Vergleichsstand an – ab dem nächsten Datenupdate werden Änderungen gemeldet.</p>'}
    </section>

    <section class="set-sec">
      <h3>💱 Broker</h3>
      ${brokerSelect()}
      <p class="muted small">Begrenzt Take Profits auf Werte, die dein Broker annimmt (Revolut: max. 150 % des aktuellen Kurses).</p>
    </section>

    <section class="set-sec">
      <h3>🏠 Als App installieren</h3>
      <p class="muted small">Chrome-Menü <b>⋮</b> → <b>„Zum Startbildschirm hinzufügen“</b> – dann öffnet StockRatio wie eine App.</p>
    </section>`;
}

// jump to a target like "#m=pf&open=plan" or "#q=NVDA" inside the running app
function applyLink(target) {
  const hash = String(target || '').replace(/^#/, '');
  const wantsPlan = new URLSearchParams(hash).get('open') === 'plan';
  ['#detail', '#settings', '#plan'].forEach((id) => { if ($(id).open) $(id).close(); });
  history.replaceState(history.state, '', hash ? `#${hash}` : location.pathname + location.search);
  Object.assign(state, { q: '', syms: [], preset: '', f: { ...DEFAULT_FILTERS }, sort: { key: 'mcap', dir: -1 } });
  readHash();
  $('#q').value = state.q;
  setMode(state.mode);
  update({ resetPage: true });
  if (wantsPlan) openPlan();
}

function openSettings() {
  const dlg = $('#settings');
  renderSettings();
  if (!dlg.open) { dlg.showModal(); history.pushState({ sr: 'settings' }, ''); }
  if (self.SRNotify) {
    SRNotify.idb.get('notify.history').then((h) => {
      if (h && h[0]) { store.set('stockratio.notify.seen', h[0].at); updateNotifyDot(); }
    }).catch(() => {});
  }
}

function bindTheme() {
  applyTheme(theme);
  DARK_MQ.addEventListener('change', () => applyTheme());
  const btn = $('#themeOpen'), menu = $('#themeMenu');
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!menu.hidden) { close(); return; }
    menu.innerHTML = themeOptionsHtml();
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    menu.querySelector('[aria-checked="true"]')?.focus();
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-pick]');
    if (!b) return;
    setTheme(b.dataset.themePick);
    close();
    btn.focus();
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.theme-wrap')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
}

function bindSettings() {
  $('#settingsOpen').addEventListener('click', openSettings);
  const dlg = $('#settings');
  dlg.addEventListener('close', () => {
    shownPrivateKey = null; // never kept beyond this dialog
    if (history.state && history.state.sr === 'settings') history.back();
  });
  window.addEventListener('popstate', () => {
    if (dlg.open && !(history.state && history.state.sr === 'settings')) dlg.close();
  });
  dlg.addEventListener('click', async (e) => {
    if (e.target === dlg || e.target.closest('[data-set-close]')) { dlg.close(); return; }
    const link = e.target.closest('[data-set-close-link]');
    if (link) {
      e.preventDefault();
      dlg.close();
      setTimeout(() => applyLink(link.getAttribute('href') || ''), 120); // after the dialog's history entry is gone
      return;
    }
    const tp = e.target.closest('[data-theme-pick]');
    if (tp) { setTheme(tp.dataset.themePick); return; }
    const act = e.target.closest('[data-set-act]');
    if (!act) return;
    const a = act.dataset.setAct;
    if (a === 'enable') await enableNotifications();
    if (a === 'test') await testNotification();
    if (a === 'keys') await generateKeys();
    if (a === 'copykey' && shownPrivateKey) {
      const k = shownPrivateKey;
      if (navigator.clipboard) navigator.clipboard.writeText(k).then(() => toast('Privater Schlüssel kopiert'), () => prompt('Privater Schlüssel:', k));
      else prompt('Privater Schlüssel:', k);
    }
    if (a === 'disconnect' && confirm('Push-Verbindung für dieses Gerät beenden? Danach musst du einen neuen Abo-Code bei GitHub hinterlegen.')) await disconnectPush();
    if (a === 'copy') {
      const sub = await currentSubscription();
      if (!sub) return;
      const code = JSON.stringify(sub.toJSON());
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => toast('Abo-Code kopiert'), () => prompt('Abo-Code:', code));
      else prompt('Abo-Code:', code);
    }
  });
  dlg.addEventListener('change', async (e) => {
    const lg = e.target.closest('[data-logos]');
    if (lg) {
      SETTINGS.logos = lg.checked;
      store.set(SETTINGS_KEY, SETTINGS);
      update({ resetPage: false });
      if (state.mode === 'portfolio') renderPortfolio();
      return;
    }
    const t = e.target.closest('[data-nset]');
    if (!t) return;
    const key = t.dataset.nset;
    if (key === 'enabled' && t.checked && Notification.permission !== 'granted') { await enableNotifications(); return; }
    NOTIFY[key] = t.checked;
    saveNotify();
    if (key === 'enabled') renderSettings();
  });
  // a tap on a notification while the app is open -> the service worker sends the target here
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.sr === 'open') applyLink(e.data.url || '');
    });
  }
}

/* ---------------------------------------------------------------- init */

function fillSelects() {
  const countryCounts = {};
  const sectorCounts = {};
  for (const s of STOCKS) {
    if (s.cty) countryCounts[s.cty] = (countryCounts[s.cty] || 0) + 1;
    if (s.sec) sectorCounts[s.sec] = (sectorCounts[s.sec] || 0) + 1;
  }
  const regionOpts = REGIONS.map(([id, label, test]) =>
    `<option value="${id}">${label} (${STOCKS.filter((s) => test(s.cty)).length})</option>`).join('');
  const countryOpts = Object.keys(countryCounts)
    .sort((a, b) => countryDe(a).localeCompare(countryDe(b), 'de'))
    .map((c) => `<option value="${esc(c)}">${esc(countryDe(c))} (${countryCounts[c]})</option>`).join('');
  $('#regionSel').innerHTML = `<option value="">Alle</option><optgroup label="Regionen">${regionOpts}</optgroup><optgroup label="Länder">${countryOpts}</optgroup>`;
  $('#sectorSel').innerHTML = '<option value="">Alle</option>' + Object.keys(sectorCounts)
    .sort((a, b) => sectorDe(a).localeCompare(sectorDe(b), 'de'))
    .map((s) => `<option value="${esc(s)}">${esc(sectorDe(s))} (${sectorCounts[s]})</option>`).join('');
}

function renderMeta() {
  const d = new Date(DATA.generated);
  const when = isNaN(d) ? DATA.generated : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  const short = isNaN(d) ? '' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  $('#meta').innerHTML = `<span class="meta-long">Datenstand <b>${esc(when)}</b> · ${STOCKS.length.toLocaleString('de-DE')} Aktien<span class="meta-src"> · Quelle: ${esc(DATA.source)}</span><br>
    S&amp;P 500 (52 W): <b>${pct(DATA.sp500_52w, 1, true, true)}</b> · <a href="#erklaerung" style="color:inherit">Erklärungen</a></span>
    <span class="meta-short">Stand <b>${esc(short)}</b><br>S&amp;P 500 52 W <b>${pct(DATA.sp500_52w, 1, true, true)}</b></span>`;
  $('#metaMob').innerHTML = `${esc(short.replace(',', ''))} · S&amp;P 500 1 J. <b>${pct(DATA.sp500_52w, 1, true, true)}</b>`;
  const w = DATA.weights || {};
  const names = { val: 'Bewertung (Forward-KGV, PEG, KGV, EV/EBITDA, FCF-Rendite – relativ zur Branche)', qual: 'Qualität (ROE, Margen, Verschuldung)', grow: 'Wachstum (Umsatz, Gewinn, erwartetes EPS-Wachstum)', ana: 'Analysten (Konsens, Kursziel-Potenzial, Gewinnrevisionen)', mom: 'Momentum (Performance vs. S&P 500, 200-Tage-Linie)' };
  $('#weightsList').innerHTML = Object.entries(w).map(([k, v]) => `<li><b>${NF[0].format(v * 100)} %</b> ${names[k] || k}</li>`).join('');
}

async function init() {
  const openPlanOnStart = new URLSearchParams(location.hash.slice(1)).get('open') === 'plan';
  const imported = readImportLink();
  readHash();
  bindEvents();
  bindPortfolio();
  bindPlan();
  bindLevels();
  bindSettings();
  bindTheme();
  registerServiceWorker();
  if (!isMobile() && (store.get('stockratio.filtersOpen', false) || Object.keys(state.f).some((k) => state.f[k] !== DEFAULT_FILTERS[k]))) {
    $('#filters').hidden = false;
    $('#toggleFilters').setAttribute('aria-expanded', 'true');
  }
  $('#q').placeholder = isMobile() ? 'Name, Ticker, ISIN …' : 'Name, Ticker oder ISIN suchen …  (Taste /)';
  $('#q').value = state.q;
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    $('#meta').textContent = 'Daten konnten nicht geladen werden.';
    $('#metaMob').textContent = 'Daten konnten nicht geladen werden.';
    $('#empty').hidden = false;
    $('#empty').textContent = `Fehler beim Laden von ${DATA_URL} (${err.message}). Wurde der Daten-Workflow schon einmal ausgeführt?`;
    return;
  }
  STOCKS = DATA.stocks || [];
  MED = DATA.sectors || {};
  BYSYM = Object.fromEntries(STOCKS.map((x) => [x.s, x]));
  if (!favsSeeded && !imported) {
    STOCKS.filter((x) => (x.idx || []).includes('WL')).forEach((x) => favs.add(x.s));
    store.set(FAV_KEY, [...favs]);
  }
  renderMeta();
  fillSelects();
  renderPresets();
  renderViews();
  update({ resetPage: false });
  setMode(state.mode, { initial: true });
  refreshPlanUi();
  if (imported) toast('Portfolio und Favoriten wurden übernommen.');
  if (openPlanOnStart) openPlan();
  runLocalCheck();
}

init();
