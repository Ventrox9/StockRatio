"""Fetches all stocks of the universe, scores them and writes site/data/stocks.json.

Run:  python -m stockratio.build [--limit N] [--workers 6]

Environment:
  PREVIOUS_DATA   URL or path of the last published stocks.json. Stocks that
                  cannot be fetched this time are taken from there (marked stale).
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .metrics import extract, major_currency
from .scoring import LABELS, PILLAR_WEIGHTS, score, sector_medians
from .universe import load_universe
from .yahoo import NotFound, YahooClient

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "site" / "data" / "stocks.json"
MIN_FRESH_SHARE = 0.5  # fail the build if fewer stocks than this could be fetched


def fetch_fx(client: YahooClient, currencies: set[str]) -> dict[str, float]:
    fx = {"USD": 1.0}
    pairs = [f"{c}USD=X" for c in sorted(currencies) if c and c != "USD"]
    if pairs:
        for q in client.quotes(pairs):
            rate = q.get("regularMarketPrice")
            if rate:
                fx[q["symbol"][:3]] = float(rate)
    return fx


# Most universe stocks trade in these currencies; others are added on demand.
BASE_CURRENCIES = {"USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "HKD", "SEK", "DKK",
                   "NOK", "SGD", "ILS", "NZD"}


def fetch_all(symbols: list[str], workers: int) -> tuple[dict[str, dict], list[str]]:
    client = YahooClient()
    fx = fetch_fx(client, BASE_CURRENCIES)
    log.info("FX rates: %s", {k: round(v, 4) for k, v in fx.items()})

    raw: dict[str, dict] = {}
    failed: list[str] = []
    started = time.monotonic()

    def task(sym: str):
        return sym, client.quote_summary(sym)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(task, s) for s in symbols]
        for i, fut in enumerate(as_completed(futures), 1):
            try:
                sym, qs = fut.result()
                raw[sym] = qs
            except NotFound as exc:
                failed.append(str(exc).rsplit("/", 1)[-1])
            except Exception as exc:
                log.warning("fetch failed: %s", exc)
            if i % 100 == 0:
                log.info("  %d/%d fetched (%.0fs)", i, len(symbols), time.monotonic() - started)

    # currencies we did not anticipate
    extra = {
        major_currency(((qs.get("price") or {}).get("currency")))[0] for qs in raw.values()
    } | {
        major_currency(((qs.get("financialData") or {}).get("financialCurrency")))[0]
        for qs in raw.values()
    }
    missing = {c for c in extra if c and c not in fx}
    if missing:
        fx.update(fetch_fx(client, missing))

    records = {}
    for sym, qs in raw.items():
        try:
            records[sym] = extract(sym, qs, fx)
        except Exception as exc:
            log.warning("could not parse %s: %s", sym, exc)
    failed = [s for s in symbols if s not in records]
    return records, failed


def load_previous(source: str | None) -> dict[str, dict]:
    if not source:
        return {}
    try:
        if source.startswith("http"):
            with urllib.request.urlopen(source, timeout=30) as resp:
                payload = json.load(resp)
        else:
            payload = json.loads(Path(source).read_text(encoding="utf-8"))
        asof = (payload.get("generated") or "")[:10] or True
        prev = {s["s"]: {**s, "_asof": asof} for s in payload.get("stocks", [])}
        log.info("previous data: %d stocks from %s", len(prev), source)
        return prev
    except Exception as exc:
        log.warning("previous data not available (%s): %s", source, exc)
        return {}


def _clean(value):
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="only the first N stocks (testing)")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    universe = load_universe()
    if args.limit:
        universe = universe.head(args.limit)
    meta = universe.set_index("symbol").to_dict("index")
    symbols = list(meta)
    log.info("fetching %d stocks with %d workers", len(symbols), args.workers)

    records, failed = fetch_all(symbols, args.workers)
    fresh = len(records)
    log.info("fetched %d/%d stocks, %d failed", fresh, len(symbols), len(failed))

    previous = load_previous(os.environ.get("PREVIOUS_DATA"))
    stale = 0
    for sym in failed:
        if sym in previous:
            rec = dict(previous[sym])  # scores are recomputed below
            rec["stale"] = rec.get("stale") or rec.get("_asof") or True
            records[sym] = rec
            stale += 1

    if fresh < MIN_FRESH_SHARE * len(symbols):
        log.error("only %d of %d stocks fetched – aborting so the old data stays online",
                  fresh, len(symbols))
        return 1

    sp52 = next((r.get("_sp52") for r in records.values() if r.get("_sp52") is not None), None)
    rows = []
    for sym, rec in records.items():
        m = meta.get(sym, {})
        rec.pop("_sp52", None)
        rec.pop("_asof", None)
        rec["idx"] = [name for name, flag in (("SP500", m.get("sp500")), ("MSCI", m.get("msci")),
                                             ("WL", m.get("watchlist"))) if flag]
        rec["w"] = _clean(m.get("msci_weight"))
        rec["isin"] = m.get("isin") or None
        if not rec.get("cty"):
            rec["cty"] = m.get("country") or None
        rows.append(rec)

    df = pd.DataFrame(rows)
    df = score(df)
    df = df.sort_values("mcap", ascending=False, na_position="last")

    stocks = []
    for rec in df.to_dict("records"):
        stocks.append({k: _clean(v) for k, v in rec.items() if _clean(v) is not None})

    payload = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "source": "Yahoo Finance",
        "count": len(stocks),
        "fresh": fresh,
        "stale": stale,
        "sp500_52w": sp52,
        "weights": PILLAR_WEIGHTS,
        "labels": LABELS,
        "sectors": sector_medians(df),
        "stocks": stocks,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                           encoding="utf-8")
    log.info("wrote %d stocks (%d stale) to %s (%.0f KB)", len(stocks), stale, args.output,
             args.output.stat().st_size / 1024)
    return 0


if __name__ == "__main__":
    sys.exit(main())
