"""Signal tracking – "paper trading" without money.

After every daily build this script records which stocks currently carry a buy signal and how
their price developed since the signal appeared. The history lives in the branch `signals`
(signals.json, one commit per day) and is published with the website as data/signals.json.

Signal types (a stock can carry several at once):
  score95    StockRatio-Score >= 95
  strongbuy  analyst consensus "Starker Kauf" (mean <= 1.5, at least 3 analysts)
  buy        "Starkes Kaufsignal" – same rule as the push notification (notify-core.js):
             score >= 90, consensus <= 2.0 with >= 5 analysts, valuation pillar >= 40

An episode starts on the first day a signal is seen and ends on the first day it is gone.
If the same signal comes back within REOPEN_DAYS the old episode continues (no flicker).
Prices are taken from the daily history: entry close, highest / lowest close since the signal,
returns after 7/30/90/180 calendar days and the S&P 500 over the same days for comparison.

On the very first run analyst signals of the last 3 months are reconstructed from Yahoo's
monthly recommendation history ("bf": backfilled, see past_consensus). Score signals can't be reconstructed –
they are tracked from the first run on.

Run:  python -m stockratio.signals --stocks site/data/stocks.json --state signals/signals.json \
          --out site/data/signals.json
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

TYPES = {
    "score95": "Score ≥ 95",
    "strongbuy": "Analysten: Starker Kauf",
    "buy": "Starkes Kaufsignal",
}
HORIZONS = (7, 30, 90, 180)  # calendar days
REOPEN_DAYS = 7
TRACK_DAYS = 400  # prices of older episodes are no longer updated
INDEX = "^GSPC"


# ------------------------------------------------------------------ signal rules

def is_signal(kind: str, s: dict) -> bool:
    if s.get("type") == "ETF":
        return False
    score, rec, n = s.get("score"), s.get("rec"), s.get("nA") or 0
    if kind == "score95":
        return score is not None and score >= 95
    if kind == "strongbuy":
        return rec is not None and rec <= 1.5 and n >= 3
    if kind == "buy":
        return (score is not None and score >= 90 and rec is not None and rec <= 2.0 and n >= 5
                and (s.get("sVal") or 0) >= 40)
    raise ValueError(kind)


def dist_mean(dist: list[int] | None) -> float | None:
    """Mean rating of a distribution [strong buy, buy, hold, sell, strong sell] (1 = strong buy)."""
    if not dist or sum(dist) < 3:
        return None
    return sum((i + 1) * n for i, n in enumerate(dist)) / sum(dist)


def past_consensus(s: dict, past: list[int] | None) -> float | None:
    """Yahoo's consensus (rec) comes from more analysts than its monthly distribution. The past
    consensus is estimated as today's consensus shifted by the change of the distribution's mean."""
    now, then = dist_mean(s.get("dist")), dist_mean(past)
    if s.get("rec") is None or now is None or then is None:
        return None
    return s["rec"] + (then - now)


def market_day(now: datetime | None = None) -> date:
    """Trading date of the data: the build runs after the US close (also when GitHub starts it late)."""
    return (now or datetime.now(timezone.utc)).astimezone(ZoneInfo("America/New_York")).date()


def months_ago(day: date, months: int) -> date:
    y, m = divmod(day.month - 1 - months, 12)
    year, month = day.year + y, m + 1
    for d in (day.day, 30, 29, 28):
        try:
            return date(year, month, d)
        except ValueError:
            continue
    raise ValueError(day)


# ------------------------------------------------------------------ episodes

def _new(kind: str, s: dict, d0: date, p0: float | None, backfilled: bool = False) -> dict:
    return {
        "id": f"{kind}:{s['s']}:{d0.isoformat()}",
        "k": kind, "s": s["s"], "n": s.get("n"), "cur": s.get("cur"),
        "d0": d0.isoformat(), "p0": p0, "sp0": None,
        "sc0": s.get("score") if not backfilled else None,
        "rec0": s.get("rec") if not backfilled else None,
        "lab0": s.get("label") if not backfilled else None,
        "bf": 1 if backfilled else 0,
        "d1": None, "p1": None,
        "hi": None, "lo": None, "last": None, "lastD": None, "r": {}, "rs": {},
    }


def backfill(state: dict, stocks: list[dict], today: date) -> int:
    """Analyst signals of the last 3 months from Yahoo's monthly recommendation trend."""
    added = 0
    for s in stocks:
        hist = s.get("distH") or []
        if s.get("type") == "ETF" or len(hist) < 3:
            continue
        # oldest first: 3, 2, 1 months ago, then today
        flags = [(past_consensus(s, h) or 9) <= 1.5 for h in (hist[2], hist[1], hist[0])]
        flags.append(is_signal("strongbuy", s))
        ep = None
        for i, flag in enumerate(flags):
            months = 3 - i
            day = months_ago(today, months) if months else today
            if flag and ep is None and months:
                ep = _new("strongbuy", s, day, None, backfilled=True)
            elif not flag and ep is not None:
                ep["d1"] = day.isoformat()
                state["e"].append(ep)
                added += 1
                ep = None
        if ep is not None:
            state["e"].append(ep)
            added += 1
    return added


def update_episodes(state: dict, stocks: list[dict], today: date) -> dict[str, int]:
    by_sym = {s["s"]: s for s in stocks}
    stats = {"new": 0, "ended": 0, "reopened": 0}
    open_eps = {(e["k"], e["s"]): e for e in state["e"] if not e["d1"]}
    day = today.isoformat()

    # stocks that left the screener: their open signals end
    for (kind, sym), ep in open_eps.items():
        if sym not in by_sym:
            ep["d1"] = day
            stats["ended"] += 1

    for kind in TYPES:
        for s in stocks:
            if s.get("stale"):
                continue  # data of an older day – no decision
            ep = open_eps.get((kind, s["s"]))
            active = is_signal(kind, s)
            if ep and not active:
                ep.update(d1=day, p1=s.get("px"), sc1=s.get("score"), rec1=s.get("rec"))
                stats["ended"] += 1
            elif not ep and active:
                recent = [e for e in state["e"] if e["k"] == kind and e["s"] == s["s"] and e["d1"]
                          and (today - date.fromisoformat(e["d1"])).days <= REOPEN_DAYS]
                if recent:
                    ep = max(recent, key=lambda e: e["d1"])
                    for key in ("d1", "p1", "sc1", "rec1"):
                        ep.pop(key, None)
                    ep["d1"] = None
                    stats["reopened"] += 1
                else:
                    state["e"].append(_new(kind, s, today, s.get("px")))
                    stats["new"] += 1
    return stats


# ------------------------------------------------------------------ prices

def _on_or_before(series: list[tuple[str, float]], day: str) -> float | None:
    val = None
    for d, c in series:
        if d > day:
            break
        val = c
    return val


def update_prices(state: dict, hist: dict[str, list[tuple[str, float]]], today: date) -> None:
    sp = hist.get(INDEX) or []
    for ep in state["e"]:
        if (today - date.fromisoformat(ep["d0"])).days > TRACK_DAYS:
            continue
        series = hist.get(ep["s"])
        if not series:
            continue
        d0 = ep["d0"]
        if ep["p0"] is None:  # backfilled: close on the signal day
            ep["p0"] = _on_or_before(series, d0) or next((c for d, c in series if d >= d0), None)
        if ep["sp0"] is None and sp:
            ep["sp0"] = _on_or_before(sp, d0)
        p0 = ep["p0"]
        if not p0:
            continue
        if ep["d1"] and ep.get("p1") is None:
            ep["p1"] = _on_or_before(series, ep["d1"])
        after = [c for d, c in series if d > d0]
        last_d, last = series[-1]
        ep["last"], ep["lastD"] = last, last_d
        if after:
            ep["hi"] = round(max(after) / p0 - 1, 4)
            ep["lo"] = round(min(after) / p0 - 1, 4)
        for n in HORIZONS:
            target = (date.fromisoformat(d0) + timedelta(days=n)).isoformat()
            if target > last_d:
                continue
            c = _on_or_before(series, target)
            if c:
                ep["r"][str(n)] = round(c / p0 - 1, 4)
            spc = _on_or_before(sp, target) if sp else None
            if spc and ep["sp0"]:
                ep["rs"][str(n)] = round(spc / ep["sp0"] - 1, 4)


def fetch_history(symbols: list[str], range_: str = "2y") -> dict[str, list[tuple[str, float]]]:
    """Daily closes by exchange-local date."""
    from .live import fetch
    from .yahoo import YahooClient

    out: dict[str, list[tuple[str, float]]] = {}
    for sym, entry in fetch(YahooClient(max_retries=4), symbols, range_, "1d").items():
        offset = int(entry["meta"].get("gmtoffset") or 0)
        series: dict[str, float] = {}
        for t, c in zip(entry["t"], entry["c"]):
            series[datetime.fromtimestamp(t + offset, timezone.utc).date().isoformat()] = c
        out[sym] = sorted(series.items())
    return out


# ------------------------------------------------------------------ main

def run(state: dict, stocks: list[dict], today: date, history=fetch_history) -> dict:
    state.setdefault("e", [])
    if not state.get("since"):
        state["since"] = today.isoformat()
        n = backfill(state, stocks, today)
        log.info("backfilled %d analyst signals (last 3 months)", n)
    stats = update_episodes(state, stocks, today)
    log.info("signals: %s, %d episodes in total", stats, len(state["e"]))

    syms = sorted({e["s"] for e in state["e"]
                   if (today - date.fromisoformat(e["d0"])).days <= TRACK_DAYS} | {INDEX})
    oldest = min((date.fromisoformat(e["d0"]) for e in state["e"]), default=today)
    range_ = "1y" if (today - oldest).days < 300 else "2y"
    try:
        hist = history(syms, range_) if history else {}
        update_prices(state, hist, today)
        if hist.get(INDEX):
            state["sp"] = {"d": hist[INDEX][-1][0], "c": hist[INDEX][-1][1]}
    except Exception as exc:  # prices are refreshed on the next run
        log.warning("price history not available: %s", exc)

    state.update(updated=datetime.now(timezone.utc).isoformat(timespec="minutes"),
                 day=today.isoformat(), types=TYPES, horizons=list(HORIZONS))
    state["e"].sort(key=lambda e: (e["d0"], e["s"]), reverse=True)
    return state


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stocks", type=Path, default=Path("site/data/stocks.json"))
    parser.add_argument("--state", type=Path, default=Path("signals/signals.json"))
    parser.add_argument("--out", type=Path, default=Path("site/data/signals.json"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    stocks = json.loads(args.stocks.read_text(encoding="utf-8")).get("stocks", [])
    state = json.loads(args.state.read_text(encoding="utf-8")) if args.state.exists() else {}
    state = run(state, stocks, market_day())
    text = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
    for path in (args.state, args.out):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    log.info("wrote %d episodes (%.0f KB)", len(state["e"]), len(text) / 1024)
    return 0


if __name__ == "__main__":
    sys.exit(main())
