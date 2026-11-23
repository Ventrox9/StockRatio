"""Current prices and price charts for every stock – published to the `live-data` branch.

The daily build (stockratio.build) computes the ratios and the score once per day.
Prices move all day, so this script runs every 15 minutes during trading hours
(workflow live.yml) and writes small files that the website loads directly:

  quotes.json      {"t": iso, "sp52": S&P 500 52-week change,
                    "q": {symbol: [price, change today, epoch, 52w high, previous close,
                                   close one year ago]}}
  i/<SYM>.json     intraday chart: {"t": iso, "1d": series, "5d": series}
  h/<SYM>.json     long-term chart: {"t": iso, "1y": series, "5y": series, "max": series}
                   (refreshed every few hours – the website appends the current price)

  series = {"s": first epoch, "d": [seconds since previous point], "c": [closes],
            "pc": close before the series, "a"/"b": session start/end (1d only)}

Run:  python -m stockratio.live --out live [--history auto|always|never] [--limit N]

Environment:
  STOCKS_URL   published stocks.json – the symbol list (fallback: data/universe.csv)
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from .universe import load_universe
from .yahoo import YahooClient

log = logging.getLogger(__name__)

SPARK_URL = "https://query1.finance.yahoo.com/v7/finance/spark"
BATCH = 20  # Yahoo's spark endpoint accepts at most 20 symbols per request
MIN_SHARE = 0.5  # publish nothing if fewer quotes than this could be fetched
HISTORY_MAX_AGE = 8 * 3600  # seconds
INDEX = "^GSPC"  # S&P 500 – quote, chart and 52-week change for "vs. S&P 500"

INTRADAY = {"1d": ("1d", "5m"), "5d": ("5d", "30m")}
HISTORY = {"1y": ("1y", "1d"), "5y": ("5y", "1wk"), "max": ("max", "1mo")}


def file_name(symbol: str) -> str:
    """Same rule as liveFile() in site/app.js."""
    return re.sub(r"[^A-Za-z0-9.\-]", "_", symbol) + ".json"


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _decimals(meta: dict, price: float | None) -> int:
    hint = int(_num(meta.get("priceHint")) or 2)
    if price is not None and abs(price) < 1:
        hint = max(hint, 4)
    return max(2, min(hint, 6))


def parse_spark(payload: dict) -> dict[str, dict]:
    """{symbol: {"meta": …, "t": [epochs], "c": [closes]}} – points without a close are dropped."""
    out: dict[str, dict] = {}
    for item in ((payload.get("spark") or {}).get("result") or []):
        resp = (item.get("response") or [None])[0] or {}
        meta = resp.get("meta") or {}
        sym = item.get("symbol") or meta.get("symbol")
        if not sym or not meta:
            continue
        closes = (((resp.get("indicators") or {}).get("quote") or [{}])[0] or {}).get("close") or []
        pts = [(int(t), _num(c)) for t, c in zip(resp.get("timestamp") or [], closes)]
        pts = [(t, c) for t, c in pts if c is not None and c > 0]
        out[sym] = {"meta": meta, "t": [t for t, _ in pts], "c": [c for _, c in pts]}
    return out


def series(entry: dict, key: str) -> dict | None:
    meta, ts, cs = entry["meta"], entry["t"], entry["c"]
    if not ts:
        return None
    dec = _decimals(meta, cs[-1])
    out = {
        "s": ts[0],
        "d": [b - a for a, b in zip(ts, ts[1:])],
        "c": [round(c, dec) for c in cs],
    }
    pc = _num(meta.get("previousClose")) if key == "1d" else None
    pc = pc or _num(meta.get("chartPreviousClose"))
    if pc and key != "max":
        out["pc"] = round(pc, dec)
    if key == "1d":
        regular = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
        a, b = _num(regular.get("start")), _num(regular.get("end"))
        # only if the session belongs to the data (not the next day's session)
        if a is not None and b and a <= ts[-1] <= b + 3600:
            out["a"], out["b"] = int(a), int(b)
    return out


def quote(entry: dict) -> list | None:
    """[price, change today, epoch of the price, 52-week high, previous close] from a 1d spark."""
    meta = entry["meta"]
    px = _num(meta.get("regularMarketPrice")) or (entry["c"][-1] if entry["c"] else None)
    if not px or px <= 0:
        return None
    prev = _num(meta.get("previousClose")) or _num(meta.get("chartPreviousClose"))
    change = (px / prev - 1) if prev else None
    if change is None and _num(meta.get("regularMarketChangePercent")) is not None:
        change = _num(meta.get("regularMarketChangePercent")) / 100
    when = int(_num(meta.get("regularMarketTime")) or (entry["t"][-1] if entry["t"] else 0)) or None
    dec = _decimals(meta, px)
    hi = _num(meta.get("fiftyTwoWeekHigh"))
    return [
        round(px, dec),
        round(change, 5) if change is not None else None,
        when,
        round(max(hi, px), dec) if hi else None,
        round(prev, dec) if prev else None,
    ]


def year_ago(year: dict | None, now: float) -> float | None:
    """Last close at least 365 days ago from a 1y series – same rule as the "1 J" chart in app.js."""
    if not year or not year.get("c"):
        return None
    t, old = year["s"], None
    for i, c in enumerate(year["c"]):
        if i:
            t += year["d"][i - 1]
        if t > now - 365 * 86400:
            break
        old = c
    return old or _num(year.get("pc")) or year["c"][0]


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def load_symbols(limit: int = 0) -> list[str]:
    symbols: list[str] = []
    source = os.environ.get("STOCKS_URL")
    if source:
        try:
            with urllib.request.urlopen(source, timeout=60) as resp:
                symbols = [s["s"] for s in json.load(resp).get("stocks", [])]
            log.info("%d symbols from %s", len(symbols), source)
        except Exception as exc:
            log.warning("symbol list not available (%s): %s", source, exc)
    if not symbols:
        symbols = list(load_universe()["symbol"])
        log.info("%d symbols from data/universe.csv", len(symbols))
    return symbols[:limit] if limit else symbols


def fetch(client: YahooClient, symbols: list[str], range_: str, interval: str,
          workers: int = 4) -> dict[str, dict]:
    batches = [symbols[i: i + BATCH] for i in range(0, len(symbols), BATCH)]

    def task(batch: list[str]) -> dict[str, dict]:
        try:
            payload = client.get_json(SPARK_URL, {"symbols": ",".join(batch), "range": range_,
                                                  "interval": interval})
            return parse_spark(payload)
        except Exception as exc:
            log.warning("spark %s/%s failed for %s…: %s", range_, interval, batch[0], exc)
            return {}

    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for part in pool.map(task, batches):
            out.update(part)
    return out


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


def history_due(out: Path, mode: str) -> bool:
    if mode != "auto":
        return mode == "always"
    stamp = out / "h" / "_updated.json"
    try:
        last = datetime.fromisoformat(json.loads(stamp.read_text())["t"]).timestamp()
    except Exception:
        return True
    return time.time() - last > HISTORY_MAX_AGE


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("live"))
    parser.add_argument("--history", choices=["auto", "always", "never"], default="auto")
    parser.add_argument("--limit", type=int, default=0, help="only the first N symbols (testing)")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    symbols = load_symbols(args.limit)
    if INDEX not in symbols:
        symbols.append(INDEX)
    client = YahooClient(max_retries=4)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    started = time.monotonic()

    intraday = {key: fetch(client, symbols, *spec, workers=args.workers)
                for key, spec in INTRADAY.items()}
    quotes = {}
    for sym, entry in intraday["1d"].items():
        q = quote(entry)
        if q:
            quotes[sym] = q
    log.info("quotes: %d/%d (%.0fs)", len(quotes), len(symbols), time.monotonic() - started)
    if len(quotes) < MIN_SHARE * len(symbols):
        log.error("only %d of %d quotes – nothing is published", len(quotes), len(symbols))
        return 1

    written = 0
    for sym in symbols:
        parts = {key: series(data[sym], key) for key, data in intraday.items() if sym in data}
        parts = {k: v for k, v in parts.items() if v}
        if parts:
            write_json(args.out / "i" / file_name(sym), {"t": now, **parts})
            written += 1
    log.info("intraday charts: %d", written)

    if history_due(args.out, args.history):
        hist = {key: fetch(client, symbols, *spec, workers=args.workers) for key, spec in HISTORY.items()}
        written = 0
        for sym in symbols:
            parts = {key: series(data[sym], key) for key, data in hist.items() if sym in data}
            parts = {k: v for k, v in parts.items() if v}
            if parts:
                write_json(args.out / "h" / file_name(sym), {"t": now, **parts})
                written += 1
        log.info("history charts: %d", written)
        if written >= MIN_SHARE * len(symbols):
            write_json(args.out / "h" / "_updated.json", {"t": now})

    # 52-week performance from the same history as the chart; symbols that failed this time
    # keep their last quote (with its own timestamp)
    previous = read_json(args.out / "quotes.json").get("q", {})
    merged, now_s = {}, time.time()
    for sym in symbols:
        q = quotes.get(sym) or previous.get(sym)
        if not q:
            continue
        ref = year_ago(read_json(args.out / "h" / file_name(sym)).get("1y"), now_s)
        merged[sym] = q[:5] + [ref]
    idx = merged.get(INDEX)
    sp52 = round(idx[0] / idx[5] - 1, 4) if idx and idx[5] else None
    write_json(args.out / "quotes.json", {"t": now, "sp52": sp52, "q": merged})

    log.info("done in %.0fs", time.monotonic() - started)
    return 0


if __name__ == "__main__":
    sys.exit(main())
