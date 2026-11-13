"""Small client for Yahoo Finance's JSON endpoints.

Uses yfinance's session handling (browser impersonation, cookie + crumb),
but calls the endpoints directly so that one request per stock returns all
modules we need (valuation, quality, growth, analysts, momentum).
"""

from __future__ import annotations

import logging
import random
import threading
import time

from yfinance.data import YfData

log = logging.getLogger(__name__)

QUOTE_SUMMARY_URL = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}"
SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search"
QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote"

SUMMARY_MODULES = ",".join(
    [
        "price",
        "summaryDetail",
        "defaultKeyStatistics",
        "financialData",
        "assetProfile",
        "recommendationTrend",
        "earningsTrend",
    ]
)


class NotFound(Exception):
    """Yahoo does not know the symbol."""


class YahooClient:
    def __init__(self, max_retries: int = 5, min_interval: float = 0.0):
        self._data = YfData()
        self.max_retries = max_retries
        # Optional global throttle between requests (seconds), shared by threads.
        self.min_interval = min_interval
        self._lock = threading.Lock()
        self._last_request = 0.0

    def _throttle(self) -> None:
        if self.min_interval <= 0:
            return
        with self._lock:
            wait = self._last_request + self.min_interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last_request = time.monotonic()

    def get_json(self, url: str, params: dict) -> dict:
        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            self._throttle()
            try:
                response = self._data.get(url, params=params, timeout=30)
                status = response.status_code
                if status == 404:
                    raise NotFound(url)
                if status == 200:
                    return response.json()
                last_error = RuntimeError(f"HTTP {status} for {url}")
            except NotFound:
                raise
            except Exception as exc:  # network errors, JSON errors, …
                last_error = exc
            # 429 / 5xx / network: exponential backoff with jitter
            delay = min(60.0, 2.0 * (2**attempt)) + random.random() * 2
            log.debug("retry %s in %.1fs (%s)", url, delay, last_error)
            time.sleep(delay)
        raise last_error or RuntimeError(f"request failed: {url}")

    def quote_summary(self, symbol: str) -> dict:
        payload = self.get_json(
            QUOTE_SUMMARY_URL.format(symbol=symbol),
            {"modules": SUMMARY_MODULES, "formatted": "false", "corsDomain": "finance.yahoo.com"},
        )
        result = (payload.get("quoteSummary") or {}).get("result") or []
        if not result:
            raise NotFound(symbol)
        return result[0]

    def search(self, query: str) -> list[dict]:
        payload = self.get_json(
            SEARCH_URL,
            {"q": query, "quotesCount": 10, "newsCount": 0, "listsCount": 0},
        )
        return payload.get("quotes") or []

    def quotes(self, symbols: list[str]) -> list[dict]:
        out: list[dict] = []
        for i in range(0, len(symbols), 50):
            chunk = symbols[i : i + 50]
            payload = self.get_json(QUOTE_URL, {"symbols": ",".join(chunk)})
            out.extend((payload.get("quoteResponse") or {}).get("result") or [])
        return out
