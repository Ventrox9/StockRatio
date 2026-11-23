from stockratio.live import file_name, parse_spark, quote, series, year_ago


def _payload():
    return {"spark": {"result": [{
        "symbol": "NVDA",
        "response": [{
            "meta": {"regularMarketPrice": 165.05, "previousClose": 125.53, "chartPreviousClose": 125.53,
                     "regularMarketTime": 1000, "fiftyTwoWeekHigh": 243.37, "priceHint": 2,
                     "currentTradingPeriod": {"regular": {"start": 0, "end": 1200}}},
            "timestamp": [0, 300, 600, 900],
            "indicators": {"quote": [{"close": [150.0, None, 160.123456, 165.05]}]},
        }],
    }]}}


def test_parse_drops_missing_closes():
    e = parse_spark(_payload())["NVDA"]
    assert e["t"] == [0, 600, 900]
    assert e["c"][0] == 150.0


def test_quote_uses_previous_close():
    q = quote(parse_spark(_payload())["NVDA"])
    assert q[0] == 165.05 and q[2] == 1000 and q[3] == 243.37 and q[4] == 125.53
    assert abs(q[1] - (165.05 / 125.53 - 1)) < 1e-4


def test_series_is_delta_encoded_with_session():
    s = series(parse_spark(_payload())["NVDA"], "1d")
    assert s["s"] == 0 and s["d"] == [600, 300] and s["c"] == [150.0, 160.12, 165.05]
    assert s["pc"] == 125.53 and (s["a"], s["b"]) == (0, 1200)


def test_year_ago_takes_last_close_before_one_year():
    day = 86400
    year = {"s": 0, "d": [day] * 3, "c": [10.0, 11.0, 12.0, 13.0], "pc": 9.0}
    assert year_ago(year, now=365 * day + 1.5 * day) == 11.0
    assert year_ago(year, now=364 * day) == 9.0  # nothing old enough -> close before the series


def test_file_name_is_safe():
    assert file_name("^GSPC") == "_GSPC.json"
    assert file_name("BRK-B") == "BRK-B.json"
