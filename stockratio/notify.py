"""Sends the daily web-push "wake-up" to all subscribed devices.

The message contains no personal data – only the type:
  update    new data is available (Mon, Tue, Thu)
  tradeday  trading day reminder (Wed, Fri)
  test      manual test from the Actions tab

Each device's service worker then compares the new data with its own portfolio,
favourites and TP/SL and decides which notifications to show.

Environment (GitHub secrets):
  VAPID_PRIVATE_KEY   private VAPID key (base64url, raw 32 bytes)
  PUSH_SUBSCRIPTIONS  JSON subscription(s) copied from the app's settings
                      – one object, a JSON list, or one object per line
  SITE_URL            used as VAPID "sub" claim (no personal contact data)

Run:  python -m stockratio.notify [--type auto|update|tradeday|test]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

TRADE_DAYS = {2, 4}  # Wednesday, Friday (Monday = 0)


def parse_subscriptions(raw: str) -> list[dict]:
    raw = (raw or "").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
        items = data if isinstance(data, list) else [data]
    except json.JSONDecodeError:
        items = [json.loads(line) for line in raw.splitlines() if line.strip()]
    subs = [s for s in items if isinstance(s, dict) and s.get("endpoint") and (s.get("keys") or {}).get("p256dh")]
    return subs


def message_type(requested: str, now: datetime | None = None) -> str:
    if requested and requested != "auto":
        return requested
    now = now or datetime.now(ZoneInfo("Europe/Berlin"))
    return "tradeday" if now.weekday() in TRADE_DAYS else "update"


def vapid_subject(site_url: str) -> str:
    """VAPID 'sub' claim: an https origin (no path) – deliberately no personal e-mail address."""
    from urllib.parse import urlparse

    host = urlparse(site_url or "").hostname
    return f"https://{host.lower()}" if host else "https://github.com"


def send_all(subs: list[dict], payload: dict, private_key: str, site_url: str) -> tuple[int, list[str]]:
    from pywebpush import WebPushException, webpush  # imported lazily: only needed in this workflow

    ok, problems = 0, []
    for i, sub in enumerate(subs, 1):
        try:
            webpush(
                subscription_info=sub,
                data=json.dumps(payload),
                vapid_private_key=private_key,
                vapid_claims={"sub": site_url},
                ttl=12 * 3600,
            )
            ok += 1
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in (404, 410):
                problems.append(f"Gerät {i}: Abo abgelaufen ({status}) – in der App neuen Abo-Code kopieren und Secret aktualisieren")
            else:
                problems.append(f"Gerät {i}: Fehler {status or ''} {exc}")
    return ok, problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--type", default="auto", choices=["auto", "update", "tradeday", "test"])
    args = parser.parse_args(argv)

    private_key = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    subs = parse_subscriptions(os.environ.get("PUSH_SUBSCRIPTIONS", ""))
    if not private_key or not subs:
        missing = [n for n, v in (("VAPID_PRIVATE_KEY", private_key), ("PUSH_SUBSCRIPTIONS", subs)) if not v]
        # fail visibly: a green run that sent nothing looks like a delivered notification
        print(f"::error::Push nicht eingerichtet (fehlende Secrets: {', '.join(missing)}) – nichts gesendet. "
              "Einrichtung: App → Glocke → „Push auch bei geschlossener App“.")
        return 1

    kind = message_type(args.type)
    payload = {"type": kind, "sent": datetime.now(ZoneInfo("UTC")).isoformat(timespec="minutes")}
    site_url = vapid_subject(os.environ.get("SITE_URL", ""))
    ok, problems = send_all(subs, payload, private_key, site_url)
    print(f"Push '{kind}' an {ok}/{len(subs)} Gerät(e) gesendet.")
    for p in problems:
        print("WARNUNG:", p)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
