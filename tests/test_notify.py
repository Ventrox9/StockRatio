from datetime import datetime

from stockratio.notify import message_type, parse_subscriptions

SUB = '{"endpoint":"https://fcm.googleapis.com/fcm/send/abc","expirationTime":null,"keys":{"p256dh":"BK","auth":"xy"}}'


def test_parse_single_list_and_lines():
    assert len(parse_subscriptions(SUB)) == 1
    assert len(parse_subscriptions(f"[{SUB},{SUB}]")) == 2
    assert len(parse_subscriptions(f"{SUB}\n{SUB}\n")) == 2
    assert parse_subscriptions("") == []
    assert parse_subscriptions('{"foo": 1}') == []


def test_message_type_by_weekday():
    assert message_type("auto", datetime(2026, 11, 18)) == "tradeday"  # Wednesday
    assert message_type("auto", datetime(2026, 11, 20)) == "tradeday"  # Friday
    assert message_type("auto", datetime(2026, 11, 16)) == "update"    # Monday
    assert message_type("test") == "test"


def test_missing_secrets_sends_nothing(monkeypatch, capsys):
    from stockratio import notify
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    monkeypatch.delenv("PUSH_SUBSCRIPTIONS", raising=False)
    assert notify.main(["--type", "test"]) == 1  # missing secrets must fail the workflow
    assert "nicht eingerichtet" in capsys.readouterr().out


def test_vapid_subject_is_origin_only():
    from stockratio.notify import vapid_subject
    assert vapid_subject("https://Ventrox9.github.io/StockRatio/") == "https://ventrox9.github.io"
    assert vapid_subject("") == "https://github.com"
