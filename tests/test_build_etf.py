from stockratio.metrics import extract


def test_etf_is_flagged_with_fund_volume():
    qs = {
        "price": {"currency": "EUR", "regularMarketPrice": 15.0, "quoteType": "ETF", "longName": "Test ETF"},
        "summaryDetail": {"totalAssets": 2e9, "twoHundredDayAverage": 12.0},
        "defaultKeyStatistics": {}, "financialData": {}, "assetProfile": {},
    }
    r = extract("ETF.DE", qs, {"USD": 1.0, "EUR": 1.1})
    assert r["type"] == "ETF"
    assert r["aum"] == 2.2
    assert r["pe"] is None and r["nA"] == 0
    assert r["ma200"] == 0.25
