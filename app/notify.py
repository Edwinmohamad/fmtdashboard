from __future__ import annotations
import urllib.request
import urllib.parse
from .db import q

# Telegram integration is intentionally dependency-free (stdlib urllib only) so it works on a bare
# CasaOS/NAS deployment without adding packages. Settings are stored in the existing key/value
# `settings` table (telegram_enabled, telegram_token, telegram_chat) and edited from System Settings.


def _settings() -> dict:
    return {r['key']: r['value'] for r in q("SELECT * FROM settings")}


def telegram_configured(settings: dict | None = None) -> bool:
    s = settings if settings is not None else _settings()
    return s.get('telegram_enabled') == '1' and bool(s.get('telegram_token')) and bool(s.get('telegram_chat'))


def send_telegram(text: str, settings: dict | None = None) -> tuple[bool, str]:
    s = settings if settings is not None else _settings()
    if not telegram_configured(s):
        return False, 'Telegram notifications are not configured'
    token = s['telegram_token']
    chat_id = s['telegram_chat']
    url = f'https://api.telegram.org/bot{token}/sendMessage'
    payload = urllib.parse.urlencode({'chat_id': chat_id, 'text': text, 'parse_mode': 'HTML', 'disable_web_page_preview': 'true'}).encode()
    try:
        req = urllib.request.Request(url, data=payload, method='POST')
        with urllib.request.urlopen(req, timeout=8) as resp:
            body = resp.read().decode('utf-8', 'ignore')
            return (200 <= resp.status < 300), body
    except Exception as exc:
        return False, str(exc)


EVENT_TEMPLATES = {
    'low_stock': "⚠️ <b>Low stock</b>\n{item_name} ({item_id}) is at {current_stock} {unit} (minimum {minimum_stock}).",
    'critical_incident': "🚨 <b>Critical incident created</b>\n{ticket_id} — {title}\nSite {site}",
    'ready_to_sign': "✍️ <b>Attendance ready to sign</b>\n{count} document(s) uploaded for {period} ({division} / {location}).",
    'approval_waiting': "⏳ <b>Approval waiting</b>\n{ticket_id} — {title} needs approval.",
    'test': "✅ FMT Operations Dashboard — Telegram notifications are connected.",
}


def notify_event(key: str, **kwargs) -> None:
    """Fire-and-forget notification for a known event key. Never raises — a notification
    failure (bad token, no network) must not break the request that triggered it."""
    try:
        s = _settings()
        if not telegram_configured(s):
            return
        tmpl = EVENT_TEMPLATES.get(key)
        if not tmpl:
            return
        text = tmpl.format(**kwargs)
        send_telegram(text, s)
    except Exception:
        pass
