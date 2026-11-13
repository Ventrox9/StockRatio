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
        items = []
        for line in raw.splitlines():
            try:
                items.append(json.loads(line.strip().rstrip(",")))
            except json.JSONDecodeError:
                continue
    subs = [s for s in items if isinstance(s, dict) and s.get("endpoint") and (s.get("keys") or {}).get("p256dh")]
    return subs


def check_private_key(key: str) -> str | None:
    """Returns a problem description, or None if the key looks like a raw base64url P-256 key."""
    import base64

    if not key:
        return "Secret VAPID_PRIVATE_KEY fehlt oder ist leer."
    try:
        raw = base64.urlsafe_b64decode(key + "=" * (-len(key) % 4))
    except ValueError:
        raw = b""
    if len(raw) != 32:
        return ("VAPID_PRIVATE_KEY hat nicht das erwartete Format (43 Zeichen aus der App, ohne Anführungszeichen "
                "oder Leerzeichen). In der App neu erzeugen und beide Secrets neu eintragen.")
    return None


def check_subscriptions(raw: str) -> tuple[list[dict], str | None]:
    """Parsed subscriptions plus a problem description (None if fine)."""
    raw = (raw or "").strip()
    if not raw:
        return [], ("Secret PUSH_SUBSCRIPTIONS fehlt oder ist leer. Bitte unter Settings → Secrets and variables → "
                    "Actions → Repository secrets genau so benennen (Großbuchstaben, mit S am Ende) und den Abo-Code "
                    "aus der App einfügen (App → Glocke → „Abo-Code kopieren“).")
    subs = parse_subscriptions(raw)
    if not subs:
        return [], ("PUSH_SUBSCRIPTIONS ist gesetzt, enthält aber keinen gültigen Abo-Code. Er muss mit "
                    '{"endpoint":"https://… beginnen – in der App „Abo-Code kopieren“ und komplett einfügen.')
    return subs, None


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

    private_key = os.environ.get("VAPID_PRIVATE_KEY", "").strip().strip('"').strip("'").strip()
    subs, sub_problem = check_subscriptions(os.environ.get("PUSH_SUBSCRIPTIONS", ""))
    problems = [p for p in (check_private_key(private_key), sub_problem) if p]
    print(f"VAPID_PRIVATE_KEY: {'gesetzt' if private_key else 'FEHLT'} · PUSH_SUBSCRIPTIONS: {len(subs)} Gerät(e)")
    if problems:
        # fail visibly: a green run that sent nothing looks like a delivered notification
        print("Push nicht eingerichtet – nichts gesendet.")
        for p in problems:
            print(f"::error::{p}")
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
