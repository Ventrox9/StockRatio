"""Builds the list of stocks to screen (data/universe.csv).

Sources:
  * S&P 500   – constituents table on Wikipedia
  * MSCI World – daily holdings of the SPDR MSCI World UCITS ETF (ISINs),
                 mapped to Yahoo symbols via Yahoo's search (cached in
                 data/isin_map.json so only new ISINs are looked up)
  * Watchlist – watchlist.txt in the repository root

If a source cannot be downloaded, the rows from the previous universe.csv are
kept, so a temporary outage never empties the screener.

Run:  python -m stockratio.universe
"""

from __future__ import annotations

import io
import json
import logging
import re
from pathlib import Path

import pandas as pd
import requests

from .yahoo import NotFound, YahooClient

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
UNIVERSE_CSV = DATA_DIR / "universe.csv"
ISIN_MAP_JSON = DATA_DIR / "isin_map.json"
WATCHLIST_TXT = ROOT / "watchlist.txt"

SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
MSCI_WORLD_HOLDINGS_URL = (
    "https://www.ssga.com/ie/en_gb/intermediary/etfs/library-content/products/"
    "fund-data/etfs/emea/holdings-daily-emea-en-sppw-gy.xlsx"
)
HTTP_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; StockRatio-Screener/1.0)"}

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")

# Yahoo symbol suffix of the primary exchange per trading country.
COUNTRY_SUFFIX = {
    "United States": "",
    "Japan": ".T",
    "United Kingdom": ".L",
    "Canada": ".TO",
    "France": ".PA",
    "Germany": ".DE",
    "Switzerland": ".SW",
    "Australia": ".AX",
    "Netherlands": ".AS",
    "Sweden": ".ST",
    "Denmark": ".CO",
    "Spain": ".MC",
    "Italy": ".MI",
    "Hong Kong": ".HK",
    "Singapore": ".SI",
    "Finland": ".HE",
    "Belgium": ".BR",
    "Norway": ".OL",
    "Israel": ".TA",
    "Ireland": ".IR",
    "Austria": ".VI",
    "New Zealand": ".NZ",
    "Portugal": ".LS",
}

COLUMNS = ["symbol", "name", "isin", "country", "sp500", "msci", "watchlist", "msci_weight"]


# --------------------------------------------------------------------------- sources


def fetch_sp500() -> pd.DataFrame:
    html = requests.get(SP500_URL, headers=HTTP_HEADERS, timeout=30).text
    table = pd.read_html(io.StringIO(html), attrs={"id": "constituents"})[0]
    df = pd.DataFrame(
        {
            # Yahoo uses "-" for share classes: BRK.B -> BRK-B
            "symbol": table["Symbol"].astype(str).str.strip().str.replace(".", "-", regex=False),
            "name": table["Security"].astype(str).str.strip(),
        }
    )
    if len(df) < 450:
        raise ValueError(f"S&P 500 table looks incomplete ({len(df)} rows)")
    return df


def fetch_msci_world_holdings() -> pd.DataFrame:
    content = requests.get(MSCI_WORLD_HOLDINGS_URL, headers=HTTP_HEADERS, timeout=60).content
    raw = pd.read_excel(io.BytesIO(content), header=None)
    header_rows = raw.index[raw[0].astype(str).str.strip() == "ISIN"].tolist()
    if not header_rows:
        raise ValueError("unexpected holdings file format (no ISIN header)")
    h = header_rows[0]
    df = raw.iloc[h + 1 :].copy()
    df.columns = [str(c).strip() for c in raw.iloc[h]]
    df = df[df["ISIN"].astype(str).str.match(ISIN_RE)]
    out = pd.DataFrame(
        {
            "isin": df["ISIN"].astype(str),
            "name": df["Security Name"].astype(str).str.strip(),
            "country": df["Trade Country Name"].astype(str).str.strip(),
            "msci_weight": pd.to_numeric(df["Percent of Fund"], errors="coerce"),
        }
    )
    if len(out) < 1000:
        raise ValueError(f"MSCI World holdings look incomplete ({len(out)} rows)")
    return out.reset_index(drop=True)


def read_watchlist(path: Path = WATCHLIST_TXT) -> list[str]:
    if not path.exists():
        return []
    symbols = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            symbols.append(line.upper())
    return list(dict.fromkeys(symbols))


# --------------------------------------------------------------------------- ISIN mapping


# Yahoo exchange codes of major US venues and of OTC / secondary markets.
US_MAJOR_EXCHANGES = {"NYQ", "NMS", "NGM", "NCM", "ASE", "PCX", "BTS", "NAS"}
OTC_EXCHANGES = {"PNK", "OQB", "OQX", "OBB", "OPR", "OEM"}

# Manual fixes for ISINs Yahoo's search does not resolve (edit if needed).
ISIN_OVERRIDES = {
    "US02079K3059": "GOOGL",  # Alphabet Class A
    "US36118L1061": "FUTU",  # Futu Holdings (Nasdaq)
}


def _matches_country(symbol: str, country: str) -> bool:
    suffix = COUNTRY_SUFFIX.get(country)
    if suffix is None:
        return False
    return ("." not in symbol) if suffix == "" else symbol.endswith(suffix)


def pick_symbol(quotes: list[dict], country: str, strict: bool = False) -> str | None:
    """Choose the best Yahoo symbol: home exchange > major US listing > other venue."""
    equities = [q for q in quotes if q.get("quoteType") == "EQUITY" and q.get("symbol")]
    for q in equities:
        if _matches_country(q["symbol"], country) and q.get("exchange") not in OTC_EXCHANGES:
            return q["symbol"]
    if strict:
        return None
    for q in equities:
        if q.get("exchange") in US_MAJOR_EXCHANGES:
            return q["symbol"]
    for q in equities:
        if q.get("exchange") not in OTC_EXCHANGES:
            return q["symbol"]
    return equities[0]["symbol"] if equities else None


_NAME_NOISE = re.compile(
    r"\b(class [a-z]|sponsored adr|adr|reg|registered|shs|ordinary shares|npv)\b", re.I
)


def resolve_isin(client: YahooClient, isin: str, name: str, country: str) -> str | None:
    if isin in ISIN_OVERRIDES:
        return ISIN_OVERRIDES[isin]
    try:
        quotes = client.search(isin)
    except NotFound:
        quotes = []
    symbol = pick_symbol(quotes, country, strict=True)
    if symbol:
        return symbol
    # Fallback: search by company name and require the home-exchange suffix.
    clean_name = _NAME_NOISE.sub("", name).strip(" .,")
    try:
        by_name = client.search(clean_name)
    except NotFound:
        by_name = []
    return pick_symbol(by_name, country, strict=True) or pick_symbol(quotes, country)


def map_isins(holdings: pd.DataFrame, client: YahooClient) -> dict[str, str | None]:
    cache: dict[str, str | None] = {}
    if ISIN_MAP_JSON.exists():
        cache = json.loads(ISIN_MAP_JSON.read_text(encoding="utf-8"))
    todo = [r for r in holdings.itertuples() if r.isin not in cache]
    log.info("ISIN mapping: %d cached, %d to look up", len(holdings) - len(todo), len(todo))
    for i, row in enumerate(todo, 1):
        try:
            cache[row.isin] = resolve_isin(client, row.isin, row.name, row.country)
        except Exception as exc:  # leave unmapped, retry next run
            log.warning("ISIN lookup failed for %s (%s): %s", row.isin, row.name, exc)
        if i % 100 == 0:
            log.info("  looked up %d/%d", i, len(todo))
            _save_isin_map(cache)
    _save_isin_map(cache)
    return cache


def _save_isin_map(cache: dict) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    ISIN_MAP_JSON.write_text(json.dumps(dict(sorted(cache.items())), indent=0), encoding="utf-8")


# --------------------------------------------------------------------------- build


def load_universe() -> pd.DataFrame:
    if UNIVERSE_CSV.exists():
        df = pd.read_csv(UNIVERSE_CSV, keep_default_na=False, na_values=[""])
        for col in ("sp500", "msci", "watchlist"):
            df[col] = df[col].astype(str).str.lower().isin(["true", "1"])
        return df
    return pd.DataFrame(columns=COLUMNS)


def build_universe(client: YahooClient | None = None) -> pd.DataFrame:
    client = client or YahooClient()
    previous = load_universe()
    rows: dict[str, dict] = {}

    def add(symbol: str, **fields) -> None:
        row = rows.setdefault(
            symbol,
            {"symbol": symbol, "name": "", "isin": "", "country": "", "sp500": False,
             "msci": False, "watchlist": False, "msci_weight": None},
        )
        for key, value in fields.items():
            if value in (None, "") or (isinstance(value, float) and pd.isna(value)):
                continue
            if key in ("name", "isin", "country") and row[key]:
                continue  # keep first (most specific) value
            row[key] = value

    # MSCI World
    try:
        holdings = fetch_msci_world_holdings()
        mapping = map_isins(holdings, client)
        unmapped = 0
        for h in holdings.itertuples():
            symbol = mapping.get(h.isin)
            if not symbol:
                unmapped += 1
                continue
            add(symbol, name=h.name, isin=h.isin, country=h.country, msci=True,
                msci_weight=round(float(h.msci_weight), 4) if pd.notna(h.msci_weight) else None)
        log.info("MSCI World: %d holdings, %d without Yahoo symbol", len(holdings), unmapped)
    except Exception as exc:
        log.warning("MSCI World download failed (%s) – keeping previous list", exc)
        for r in previous[previous["msci"]].to_dict("records"):
            add(r["symbol"], name=r["name"], isin=r["isin"], country=r["country"], msci=True,
                msci_weight=r.get("msci_weight"))

    # S&P 500
    try:
        sp = fetch_sp500()
        for r in sp.itertuples():
            add(r.symbol, name=r.name, country="United States", sp500=True)
        log.info("S&P 500: %d constituents", len(sp))
    except Exception as exc:
        log.warning("S&P 500 download failed (%s) – keeping previous list", exc)
        for r in previous[previous["sp500"]].to_dict("records"):
            add(r["symbol"], name=r["name"], country=r["country"], sp500=True)

    # Watchlist
    for symbol in read_watchlist():
        add(symbol, watchlist=True)

    df = pd.DataFrame(list(rows.values()), columns=COLUMNS)
    df = df.sort_values(["msci_weight", "symbol"], ascending=[False, True], na_position="last")
    return df.reset_index(drop=True)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    df = build_universe()
    DATA_DIR.mkdir(exist_ok=True)
    df.to_csv(UNIVERSE_CSV, index=False)
    log.info(
        "universe: %d stocks (S&P 500: %d, MSCI World: %d, Watchlist: %d) -> %s",
        len(df), df["sp500"].sum(), df["msci"].sum(), df["watchlist"].sum(), UNIVERSE_CSV,
    )


if __name__ == "__main__":
    main()
