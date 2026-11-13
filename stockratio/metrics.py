"""Turns a raw Yahoo quoteSummary response into one flat record per stock."""

from __future__ import annotations

import math


def _num(value) -> float | None:
    """Yahoo returns plain numbers (formatted=false) but sometimes {raw: …} or {}."""
    if isinstance(value, dict):
        value = value.get("raw")
    if isinstance(value, bool) or value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _pos(value, upper: float = math.inf) -> float | None:
    """Positive, plausible ratio or None."""
    v = _num(value)
    return v if v is not None and 0 < v < upper else None


def _round(value: float | None, digits: int) -> float | None:
    return None if value is None else round(value, digits)


def major_currency(currency: str | None) -> tuple[str | None, float]:
    """Yahoo quotes some markets in minor units (GBp, ZAc, ILA)."""
    minor = {"GBp": ("GBP", 0.01), "GBX": ("GBP", 0.01), "ZAc": ("ZAR", 0.01), "ILA": ("ILS", 0.01)}
    if currency in minor:
        return minor[currency]
    return currency, 1.0


def extract(symbol: str, qs: dict, fx_to_usd: dict[str, float]) -> dict:
    price = qs.get("price") or {}
    sd = qs.get("summaryDetail") or {}
    ks = qs.get("defaultKeyStatistics") or {}
    fd = qs.get("financialData") or {}
    ap = qs.get("assetProfile") or {}

    currency = price.get("currency") or sd.get("currency")
    major, _ = major_currency(currency)
    fx = fx_to_usd.get(major or "", None)
    fin_fx = fx_to_usd.get(major_currency(fd.get("financialCurrency"))[0] or "", None)

    px = _num(price.get("regularMarketPrice")) or _num(fd.get("currentPrice"))
    mcap = _num(sd.get("marketCap")) or _num(price.get("marketCap"))  # in major currency
    mcap_usd = mcap * fx if (mcap and fx) else None

    # --- valuation -------------------------------------------------------------
    trailing_eps = _num(ks.get("trailingEps"))
    pe = _pos(sd.get("trailingPE"), 1000)
    if pe is None and trailing_eps is not None and trailing_eps <= 0:
        pe = -1.0  # negative earnings
    fpe_raw = _num(sd.get("forwardPE")) or _num(ks.get("forwardPE"))
    fpe = None
    if fpe_raw is not None:
        fpe = -1.0 if fpe_raw <= 0 else (fpe_raw if fpe_raw < 1000 else None)

    growth = _earnings_growth(qs)
    peg = _pos(ks.get("pegRatio"), 50)
    peg_src = "yahoo" if peg is not None else None
    g_next = growth.get("+1y")
    if peg is None and fpe and fpe > 0 and g_next and g_next > 0.01:
        peg = fpe / (g_next * 100)
        peg_src = "calc"

    fcf = _num(fd.get("freeCashflow"))
    fcf_yield = (fcf * fin_fx / mcap_usd) if (fcf is not None and fin_fx and mcap_usd) else None
    if fcf_yield is not None and abs(fcf_yield) > 1:
        fcf_yield = None  # currency/unit mismatch – implausible

    # --- analysts ----------------------------------------------------------------
    target = _num(fd.get("targetMeanPrice"))
    n_analysts = _num(fd.get("numberOfAnalystOpinions"))
    upside = (target / px - 1) if (target and px) else None
    if upside is not None and not (-0.95 < upside < 5):
        upside = None
    dist = _recommendation_distribution(qs)
    rec = _num(fd.get("recommendationMean"))
    if dist and (rec is None or not n_analysts):
        # Yahoo sometimes omits the mean although the distribution is there.
        total = sum(dist)
        rec = rec if rec is not None else sum((i + 1) * n for i, n in enumerate(dist)) / total
        n_analysts = n_analysts or total

    # --- momentum ----------------------------------------------------------------
    r52 = _num(ks.get("52WeekChange"))
    sp52 = _num(ks.get("SandP52WeekChange"))
    rel52 = ((1 + r52) / (1 + sp52) - 1) if (r52 is not None and sp52 is not None) else None
    ma200 = _num(sd.get("twoHundredDayAverage"))
    hi52 = _num(sd.get("fiftyTwoWeekHigh"))

    de = _num(fd.get("debtToEquity"))

    return {
        "s": symbol,
        "type": "ETF" if price.get("quoteType") == "ETF" else None,
        "aum": _round(_num(sd.get("totalAssets")) * fx / 1e9, 2)
        if (price.get("quoteType") == "ETF" and _num(sd.get("totalAssets")) and fx) else None,
        "n": price.get("longName") or price.get("shortName") or symbol,
        "ex": price.get("exchangeName"),
        "cur": currency,
        "sec": ap.get("sector"),
        "ind": ap.get("industry"),
        "cty": ap.get("country"),
        "web": ap.get("website"),
        "px": _round(px, 4),
        "d1": _round(_num(price.get("regularMarketChangePercent")), 4),
        "mcap": _round(mcap_usd / 1e9, 2) if mcap_usd else None,  # bn USD
        # valuation
        "pe": _round(pe, 2),
        "fpe": _round(fpe, 2),
        "peg": _round(peg, 2),
        "pegSrc": peg_src,
        "pb": _round(_pos(ks.get("priceToBook"), 500), 2),
        "ps": _round(_pos(sd.get("priceToSalesTrailing12Months"), 500), 2),
        "evEbitda": _round(_pos(ks.get("enterpriseToEbitda"), 500), 2),
        "fcfY": _round(fcf_yield, 4),
        "divY": _round(_num(sd.get("dividendYield")), 4),
        "payout": _round(_num(sd.get("payoutRatio")), 4),
        # quality
        "roe": _round(_num(fd.get("returnOnEquity")), 4),
        "opm": _round(_num(fd.get("operatingMargins")), 4),
        "npm": _round(_num(fd.get("profitMargins")), 4),
        "de": _round(de / 100 if de is not None else None, 3),
        # growth
        "revG": _round(_num(fd.get("revenueGrowth")), 4),
        "epsG": _round(_num(fd.get("earningsGrowth")), 4),
        "epsGcy": _round(growth.get("0y"), 4),
        "epsGny": _round(g_next, 4),
        # analysts
        "rec": _round(rec, 2),
        "recKey": fd.get("recommendationKey") if fd.get("recommendationKey") != "none" else None,
        "nA": int(n_analysts) if n_analysts else 0,
        "tgt": _round(target, 4),
        "up": _round(upside, 4),
        "dist": dist,
        "rev90": _round(_eps_revision(qs), 4),
        # momentum / risk
        "r52": _round(r52, 4),
        "rel52": _round(rel52, 4),
        "ma200": _round((px / ma200 - 1) if (px and ma200) else None, 4),
        "hi52": _round((px / hi52 - 1) if (px and hi52) else None, 4),
        "beta": _round(_num(sd.get("beta")) or _num(ks.get("beta")), 2),
        "_sp52": sp52,
    }


def _earnings_growth(qs: dict) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for t in (qs.get("earningsTrend") or {}).get("trend") or []:
        g = _num(t.get("growth"))
        if g is not None and -1 < g < 10:
            out[t.get("period")] = g
    return out


def _eps_revision(qs: dict) -> float | None:
    """Change of next-year EPS consensus over the last 90 days (fallback: current year)."""
    trends = {t.get("period"): t for t in (qs.get("earningsTrend") or {}).get("trend") or []}
    for period in ("+1y", "0y"):
        eps_trend = (trends.get(period) or {}).get("epsTrend") or {}
        now, ago = _num(eps_trend.get("current")), _num(eps_trend.get("90daysAgo"))
        if now is not None and ago and ago > 0:
            change = now / ago - 1
            return change if -1 < change < 1 else None
    return None


def _recommendation_distribution(qs: dict) -> list[int] | None:
    for t in (qs.get("recommendationTrend") or {}).get("trend") or []:
        if t.get("period") == "0m":
            dist = [int(_num(t.get(k)) or 0) for k in ("strongBuy", "buy", "hold", "sell", "strongSell")]
            return dist if sum(dist) else None
    return None
