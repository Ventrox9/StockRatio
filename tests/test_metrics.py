from stockratio.metrics import extract, major_currency

FX = {"USD": 1.0, "GBP": 1.3}


def summary(**over):
    qs = {
        "price": {"currency": "USD", "regularMarketPrice": 100.0, "longName": "Test Corp",
                  "regularMarketChangePercent": 0.01},
        "summaryDetail": {"marketCap": 50e9, "trailingPE": 20.0, "forwardPE": 16.0,
                          "dividendYield": 0.02, "twoHundredDayAverage": 80.0,
                          "fiftyTwoWeekHigh": 125.0},
        "defaultKeyStatistics": {"pegRatio": 1.5, "trailingEps": 5.0, "52WeekChange": 0.32,
                                 "SandP52WeekChange": 0.10},
        "financialData": {"financialCurrency": "USD", "freeCashflow": 2.5e9, "targetMeanPrice": 120.0,
                          "numberOfAnalystOpinions": 20, "recommendationMean": 1.8,
                          "debtToEquity": 150.0, "returnOnEquity": 0.25},
        "assetProfile": {"sector": "Technology", "country": "United States"},
        "recommendationTrend": {"trend": [{"period": "0m", "strongBuy": 5, "buy": 10, "hold": 4,
                                           "sell": 1, "strongSell": 0}]},
        "earningsTrend": {"trend": [{"period": "+1y", "growth": 0.20,
                                     "epsTrend": {"current": 5.5, "90daysAgo": 5.0}}]},
    }
    for key, value in over.items():
        qs[key] = {**qs.get(key, {}), **value}
    return qs


def test_basic_fields():
    r = extract("TST", summary(), FX)
    assert r["pe"] == 20.0 and r["fpe"] == 16.0 and r["peg"] == 1.5 and r["pegSrc"] == "yahoo"
    assert r["mcap"] == 50.0
    assert r["fcfY"] == 0.05
    assert r["up"] == 0.2
    assert r["de"] == 1.5
    assert r["dist"] == [5, 10, 4, 1, 0]
    assert r["rel52"] == 0.2  # 1.32 / 1.10 - 1
    assert r["ma200"] == 0.25
    assert r["hi52"] == -0.2
    assert r["rev90"] == 0.1


def test_negative_earnings_and_calculated_peg():
    r = extract("TST", summary(summaryDetail={"trailingPE": None, "forwardPE": -12.0},
                               defaultKeyStatistics={"trailingEps": -1.0, "pegRatio": None}), FX)
    assert r["pe"] == -1.0 and r["fpe"] == -1.0
    assert r["peg"] is None  # no PEG for negative earnings

    r = extract("TST", summary(defaultKeyStatistics={"pegRatio": None}), FX)
    assert r["peg"] == 0.8 and r["pegSrc"] == "calc"  # 16 / 20


def test_minor_currency_and_cross_currency_fcf():
    assert major_currency("GBp") == ("GBP", 0.01)
    r = extract("TST.L", summary(price={"currency": "GBp", "regularMarketPrice": 2000.0},
                                 summaryDetail={"marketCap": 10e9},
                                 financialData={"financialCurrency": "USD", "freeCashflow": 1.3e9,
                                                "targetMeanPrice": 2400.0}), FX)
    assert r["mcap"] == 13.0  # 10 bn GBP in USD
    assert r["fcfY"] == 0.1  # 1.3 bn USD / 13 bn USD
    assert r["up"] == 0.2


def test_missing_recommendation_mean_uses_distribution():
    r = extract("TST", summary(financialData={"recommendationMean": None, "numberOfAnalystOpinions": None}), FX)
    assert r["nA"] == 20
    assert r["rec"] == round((5 * 1 + 10 * 2 + 4 * 3 + 1 * 4) / 20, 2)
