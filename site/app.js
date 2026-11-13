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
  preset: '',
  view: 'overview',
  sort: { key: 'mcap', dir: -1 },
  page: 1,
  shown: CARD_STEP,
  f: { ...DEFAULT_FILTERS },
};

let DATA = null;
let STOCKS = [];
let MED = {};
let filtered = [];

const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};
const favs = new Set(store.get('stockratio.favs', []));

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
      return `<div class="name-cell"><button class="star ${favs.has(s.s) ? 'on' : ''}" data-fav="${esc(s.s)}" aria-label="Favorit">★</button>
        <div><span class="nm" title="${esc(s.n)}">${esc(s.n)}</span>
        <span class="tk">${esc(s.s)}${iso ? ' · ' + iso : ''}${stale}</span></div></div>`;
    },
  },
  score: {
    label: 'Score', help: 'StockRatio-Score 0–100 (Perzentil): Bewertung, Qualität, Wachstum, Analysten, Momentum.',
    sort: (s) => s.score, dir: -1, cls: 'l',
    render: (s) => isNum(s.score)
      ? `<span class="pill lv-${s.label}"><span class="score-num">${NF[0].format(s.score)}</span><span class="lbl">${esc(s.label)}</span></span>`
      : NA,
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

// [id, label, table columns, short label (mobile), card fields (mobile)]
const VIEWS = [
  ['overview', 'Übersicht', ['name', 'score', 'px', 'd1', 'mcap', 'pe', 'fpe', 'peg', 'valB', 'cons', 'up', 'rel52'],
    'Übersicht', ['fpe', 'peg', 'valB', 'cons', 'up', 'rel52']],
  ['valuation', 'Bewertung', ['name', 'score', 'sec', 'pe', 'fpe', 'fpeMed', 'peg', 'pb', 'ps', 'evEbitda', 'fcfY', 'divY', 'sVal'],
    'Bewertung', ['pe', 'fpe', 'fpeMed', 'peg', 'evEbitda', 'fcfY', 'divY', 'pb', 'ps']],
  ['quality', 'Qualität & Wachstum', ['name', 'score', 'sec', 'roe', 'opm', 'npm', 'de', 'revG', 'epsG', 'epsGny', 'sQual', 'sGrow'],
    'Qualität', ['roe', 'opm', 'de', 'revG', 'epsG', 'epsGny']],
  ['analysts', 'Analysten & Momentum', ['name', 'score', 'cons', 'dist', 'nA', 'up', 'rev90', 'r52', 'rel52', 'ma200', 'hi52', 'beta', 'sAna', 'sMom'],
    'Analysten', ['cons', 'nA', 'up', 'rev90', 'rel52', 'ma200']],
];
// Extra sort options offered in the mobile sort menu (besides the view's fields).
const MOBILE_SORT_EXTRA = ['score', 'mcap', 'name', 'd1'];

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
  { id: 'top', label: 'Top-Score', desc: 'Die am besten bewerteten Aktien nach StockRatio-Score',
    test: (s) => isNum(s.score), sort: { key: 'score', dir: -1 } },
  { id: 'cheapStrong', label: 'Günstig & stark', desc: 'Score ≥ 70 und Bewertungs-Score ≥ 60',
    test: (s) => s.score >= 70 && s.sVal >= 60, sort: { key: 'score', dir: -1 } },
  { id: 'garp', label: 'Wachstum zum fairen Preis', desc: 'PEG < 1, positives Forward-KGV, > 5 % erwartetes Gewinnwachstum, mind. 3 Analysten',
    test: (s) => s.peg > 0 && s.peg < 1 && s.fpe > 0 && s.epsGny > 0.05 && s.nA >= 3, sort: { key: 'peg', dir: 1 } },
  { id: 'value', label: 'Value (KGV < 15)', desc: 'KGV und Forward-KGV unter 15, solide Qualität',
    test: (s) => s.pe > 0 && s.pe < 15 && s.fpe > 0 && s.fpe < 15 && s.sQual >= 40, sort: { key: 'fpe', dir: 1 } },
  { id: 'analysts', label: 'Analysten-Lieblinge', desc: 'Konsens „Kaufen“ (≤ 1,8), mind. 10 Analysten, ≥ 15 % Kursziel-Potenzial',
    test: (s) => s.rec <= 1.8 && s.nA >= 10 && s.up >= 0.15, sort: { key: 'up', dir: -1 } },
  { id: 'dividend', label: 'Dividenden-Qualität', desc: '≥ 3 % Dividende, Ausschüttungsquote ≤ 80 %, Qualitäts-Score ≥ 50',
    test: (s) => s.divY >= 0.03 && isNum(s.payout) && s.payout <= 0.8 && s.sQual >= 50, sort: { key: 'divY', dir: -1 } },
  { id: 'expensive', label: 'Zu teuer – Vorsicht', desc: 'Die teuersten 15 % nach Bewertungs-Score',
    test: (s) => isNum(s.sVal) && s.sVal <= 15, sort: { key: 'sVal', dir: 1 } },
  { id: 'watch', label: '★ Watchlist', desc: 'Aktien aus watchlist.txt und deine Favoriten (★)',
    test: (s) => favs.has(s.s) || (s.idx || []).includes('WL'), sort: { key: 'score', dir: -1 } },
];

/* ---------------------------------------------------------------- filtering */

function parseNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function matches(s) {
  const f = state.f;
  if (state.q) {
    const q = state.q.toLowerCase();
    if (!(s.s.toLowerCase().includes(q) || (s.n || '').toLowerCase().includes(q) || (s.isin || '').toLowerCase() === q)) return false;
  }
  const preset = PRESETS.find((p) => p.id === state.preset);
  if (preset && preset.test && !preset.test(s)) return false;

  if (f.index) {
    if (f.index === 'FAV') { if (!favs.has(s.s)) return false; }
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

function sortRows(rows) {
  const col = COLUMNS[state.sort.key];
  if (!col) return rows;
  const dir = state.sort.dir;
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
  const cols = currentView()[2];
  $('#table thead').innerHTML = '<tr>' + cols.map((key) => {
    const c = COLUMNS[key];
    const active = state.sort.key === key;
    const arrow = active ? (state.sort.dir === 1 ? '▲' : '▼') : '';
    const sortAttr = active ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none';
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

function renderCards() {
  $('#table tbody').innerHTML = '';
  const fields = currentView()[4];
  const rows = filtered.slice(0, state.shown);
  $('#cards').innerHTML = rows.map((s) => {
    const iso = countryIso(s.cty);
    const score = isNum(s.score)
      ? `<span class="score-num">${NF[0].format(s.score)}</span><span class="lbl">${esc(s.label)}</span>`
      : '<span class="na">kein Score</span>';
    const stale = s.stale ? ' <span class="stale">⚠</span>' : '';
    return `<article class="scard" data-sym="${esc(s.s)}" tabindex="0">
      <div class="sc-top">
        <button class="star ${favs.has(s.s) ? 'on' : ''}" data-fav="${esc(s.s)}" aria-label="Favorit">★</button>
        <div class="sc-name"><span class="nm">${esc(s.n)}</span>
          <span class="tk">${esc(s.s)}${iso ? ' · ' + iso : ''} · ${esc(sectorDe(s.sec))}${stale}</span></div>
        <div class="sc-score pill lv-${esc(s.label || 'Neutral')}">${score}</div>
      </div>
      <div class="sc-px"><span class="p">${priceFmt(s)}</span>${pct(s.d1, 1, true, true)}<span class="m">${mcapFmt(s.mcap)}</span></div>
      <div class="sc-grid">${fields.map((k) => `<div><small>${esc(COLUMNS[k].label)}</small><b>${COLUMNS[k].render(s)}</b></div>`).join('')}</div>
    </article>`;
  }).join('');
  const rest = filtered.length - rows.length;
  const more = $('#more');
  more.hidden = rest <= 0;
  more.textContent = `Weitere ${Math.min(CARD_STEP, rest)} anzeigen (noch ${rest.toLocaleString('de-DE')})`;
  $('#emptyCards').hidden = filtered.length > 0;
  $('#pager').innerHTML = '';
}

function renderSortSelect() {
  const keys = [...new Set([...MOBILE_SORT_EXTRA, ...currentView()[4], state.sort.key])].filter((k) => COLUMNS[k]);
  const names = { name: 'Name', score: 'Score', mcap: 'Marktkap.', d1: 'Tagesänderung' };
  $('#sortSel').innerHTML = keys.map((k) =>
    `<option value="${k}" ${k === state.sort.key ? 'selected' : ''}>${esc(names[k] || COLUMNS[k].label)}</option>`).join('');
  $('#sortDir').textContent = state.sort.dir === 1 ? '↑' : '↓';
  $('#sortDir').title = state.sort.dir === 1 ? 'aufsteigend' : 'absteigend';
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
  let active = 0;
  document.querySelectorAll('[data-f]').forEach((el) => {
    const key = el.dataset.f;
    const value = state.f[key];
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value ?? '';
    const isActive = el.type === 'checkbox' ? !!value : value !== '' && value !== null;
    el.classList.toggle('active-f', isActive && el.type !== 'checkbox');
    if (isActive) active += 1;
  });
  const badge = $('#filterCount');
  badge.hidden = active === 0;
  badge.textContent = active;
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
  if (state.q) p.set('q', state.q);
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
  state.preset = PRESETS.some((x) => x.id === p.get('p')) ? p.get('p') : '';
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
  const idxNames = { SP500: 'S&P 500', MSCI: 'MSCI World', WL: 'Watchlist' };
  const tags = [
    s.sec ? `${sectorDe(s.sec)}${s.ind ? ' · ' + s.ind : ''}` : null,
    s.cty ? countryDe(s.cty) : null,
    ...(s.idx || []).map((i) => idxNames[i]),
    isNum(s.w) ? `MSCI-Gewicht ${NF[2].format(s.w)} %` : null,
  ].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('');

  const bars = PILLARS.map(([key, label]) => {
    const v = s[key];
    return `<div class="bar-row"><span>${label}</span><span class="bar"><i style="width:${isNum(v) ? v : 0}%"></i></span><b>${isNum(v) ? NF[0].format(v) : '–'}</b></div>`;
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
      <div>
        <h2 id="dTitle">${esc(s.n)}</h2>
        <div class="tk">${esc(s.s)}${s.ex ? ' · ' + esc(s.ex) : ''}${s.isin ? ' · ISIN ' + esc(s.isin) : ''}${iso ? ' · ' + iso : ''}</div>
      </div>
      <button class="close" aria-label="Schließen" data-close>×</button>
    </div>
    <div class="d-tags">${tags}</div>
    <div class="d-price">${priceFmt(s)} <small>${pct(s.d1, 2, true, true)} heute</small> <small class="muted">· ${mcapFmt(s.mcap)}</small></div>
    ${s.stale ? `<p class="stale">⚠ Konnte zuletzt nicht aktualisiert werden – Daten vom ${esc(s.stale)}.</p>` : ''}

    <div class="d-grid">
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
      </section>

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

      <section class="card">
        <h3>Einordnung</h3>
        <ul class="reasons">
          ${plus.map((t) => `<li class="plus">${esc(t)}</li>`).join('')}
          ${minus.map((t) => `<li class="minus">${esc(t)}</li>`).join('')}
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
      </section>
    </div>

    <div class="links">
      <a href="https://finance.yahoo.com/quote/${encodeURIComponent(s.s)}" target="_blank" rel="noopener">Yahoo Finance ↗</a>
      ${s.web && /^https?:\/\//.test(s.web) ? `<a href="${esc(s.web)}" target="_blank" rel="noopener">Unternehmens-Website ↗</a>` : ''}
      <button class="btn ghost" data-fav="${esc(s.s)}">${favs.has(s.s) ? '★ Aus Favoriten entfernen' : '☆ Zu Favoriten'}</button>
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
  store.set('stockratio.favs', [...favs]);
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
    state.preset = '';
    state.f = { ...DEFAULT_FILTERS };
    state.sort = { key: 'mcap', dir: -1 };
    update();
  };
  $('#reset').addEventListener('click', resetAll);
  $('#resetSheet').addEventListener('click', resetAll);

  $('#sortSel').addEventListener('change', (e) => {
    const key = e.target.value;
    state.sort = { key, dir: COLUMNS[key].dir || -1 };
    update();
  });
  $('#sortDir').addEventListener('click', () => { state.sort.dir *= -1; update(); });

  $('#more').addEventListener('click', () => { state.shown += CARD_STEP; renderCards(); });

  $('#cards').addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      e.stopPropagation();
      toggleFav(fav.dataset.fav);
      fav.classList.toggle('on', favs.has(fav.dataset.fav));
      renderPresets();
      if (state.preset === 'watch' || state.f.index === 'FAV') update({ resetPage: false });
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
      if (state.preset === 'watch' || state.f.index === 'FAV') update({ resetPage: false });
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
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      toggleFav(fav.dataset.fav);
      openDetail(fav.dataset.fav);
      renderPresets();
      update({ resetPage: false });
    }
  });
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
  $('#meta').innerHTML = `Datenstand <b>${esc(when)}</b> · ${STOCKS.length.toLocaleString('de-DE')} Aktien<span class="meta-src"> · Quelle: ${esc(DATA.source)}</span><br>
    S&amp;P 500 (52 W): <b>${pct(DATA.sp500_52w, 1, true, true)}</b> · <a href="#erklaerung" style="color:inherit">Erklärungen</a>`;
  const w = DATA.weights || {};
  const names = { val: 'Bewertung (Forward-KGV, PEG, KGV, EV/EBITDA, FCF-Rendite – relativ zur Branche)', qual: 'Qualität (ROE, Margen, Verschuldung)', grow: 'Wachstum (Umsatz, Gewinn, erwartetes EPS-Wachstum)', ana: 'Analysten (Konsens, Kursziel-Potenzial, Gewinnrevisionen)', mom: 'Momentum (Performance vs. S&P 500, 200-Tage-Linie)' };
  $('#weightsList').innerHTML = Object.entries(w).map(([k, v]) => `<li><b>${NF[0].format(v * 100)} %</b> ${names[k] || k}</li>`).join('');
}

async function init() {
  readHash();
  bindEvents();
  if (!isMobile() && (store.get('stockratio.filtersOpen', false) || Object.keys(state.f).some((k) => state.f[k] !== DEFAULT_FILTERS[k]))) {
    $('#filters').hidden = false;
    $('#toggleFilters').setAttribute('aria-expanded', 'true');
  }
  if (!isMobile()) $('#q').placeholder = 'Name, Ticker oder ISIN suchen …  (Taste /)';
  $('#q').value = state.q;
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    $('#meta').textContent = 'Daten konnten nicht geladen werden.';
    $('#empty').hidden = false;
    $('#empty').textContent = `Fehler beim Laden von ${DATA_URL} (${err.message}). Wurde der Daten-Workflow schon einmal ausgeführt?`;
    return;
  }
  STOCKS = DATA.stocks || [];
  MED = DATA.sectors || {};
  renderMeta();
  fillSelects();
  renderPresets();
  renderViews();
  update({ resetPage: false });
}

init();
