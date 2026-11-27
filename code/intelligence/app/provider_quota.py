"""Persistent, race-free budget for external (Groq Free tier) generation requests.

Every attempted provider request — first generation, citation correction, retries and ambiguous
network failures — reserves tokens *before* it is sent, inside an IMMEDIATE SQLite transaction, so
concurrent requests cannot overshoot. Actual usage replaces the reservation when the provider
reports it; failures that may still have consumed quota keep their reservation. Limits are stored
in the persistent intelligence database, so refreshes, logins, restarts and EC2 stop/start never
reset them. Budgets stay below the verified Free-tier organization limits (see config).
"""
import sqlite3
import time
from datetime import datetime, timezone

from .config import settings


class QuotaExceeded(Exception):
    def __init__(self, reason, retry_after=None):
        super().__init__(reason)
        self.reason = reason
        self.retry_after = retry_after


def _db():
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(settings.data_dir / 'cloudvault.db', timeout=30, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute(
        'CREATE TABLE IF NOT EXISTS provider_usage(id INTEGER PRIMARY KEY, provider TEXT NOT NULL, '
        'actor TEXT NOT NULL, kind TEXT NOT NULL, at REAL NOT NULL, day TEXT NOT NULL, '
        'reserved_tokens INTEGER NOT NULL, actual_tokens INTEGER, status TEXT NOT NULL)')
    db.execute('CREATE INDEX IF NOT EXISTS provider_usage_day ON provider_usage(provider, day)')
    db.execute('CREATE TABLE IF NOT EXISTS provider_state(key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    return db


def _today(now):
    return datetime.fromtimestamp(now, timezone.utc).strftime('%Y-%m-%d')


def cooldown(provider='groq'):
    """(until_epoch, reason) if the provider is cooling down after 429/401/etc."""
    db = _db()
    try:
        row = db.execute('SELECT value FROM provider_state WHERE key=?', (f'{provider}:cooldown',)).fetchone()
    finally:
        db.close()
    if not row:
        return None
    until, _, reason = row['value'].partition('|')
    return (float(until), reason) if float(until) > time.time() else None


def set_cooldown(seconds, reason, provider='groq'):
    db = _db()
    try:
        db.execute('INSERT OR REPLACE INTO provider_state VALUES(?,?)',
                   (f'{provider}:cooldown', f'{time.time() + seconds}|{reason}'))
    finally:
        db.close()


def reserve(actor, estimated_tokens, kind, provider='groq'):
    """Reserve budget for one provider request or raise QuotaExceeded. Returns the usage row id."""
    now = time.time()
    day = _today(now)
    db = _db()
    try:
        db.execute('BEGIN IMMEDIATE')
        tokens = lambda where, args: db.execute(  # noqa: E731
            f'SELECT COUNT(*) n, COALESCE(SUM(COALESCE(actual_tokens, reserved_tokens)),0) t '
            f'FROM provider_usage WHERE provider=? AND {where}', (provider, *args)).fetchone()
        minute = tokens('at > ?', (now - 60,))
        daily = tokens('day = ?', (day,))
        user = tokens('day = ? AND actor = ?', (day, actor))
        problem = None
        if minute['n'] + 1 > settings.groq_minute_requests or minute['t'] + estimated_tokens > settings.groq_minute_tokens:
            problem = ('Fast cloud AI is briefly busy (per-minute limit). Try again in a minute.', 60)
        elif daily['n'] + 1 > settings.groq_daily_requests or daily['t'] + estimated_tokens > settings.groq_daily_tokens:
            problem = ("Today's shared fast cloud AI allowance is used up. It resets at 00:00 UTC.", None)
        elif kind == 'generation' and user['n'] + 1 > settings.groq_user_daily_requests:
            problem = ('Your daily fast cloud AI allowance is used up. It resets at 00:00 UTC.', None)
        if problem:
            db.execute('ROLLBACK')
            raise QuotaExceeded(*problem)
        cursor = db.execute(
            'INSERT INTO provider_usage(provider,actor,kind,at,day,reserved_tokens,status) VALUES(?,?,?,?,?,?,?)',
            (provider, actor, kind, now, day, int(estimated_tokens), 'reserved'))
        db.execute('COMMIT')
        return cursor.lastrowid
    finally:
        db.close()


def settle(usage_id, actual_tokens, status):
    """Record actual consumption. Leave the reservation when consumption cannot be ruled out."""
    db = _db()
    try:
        db.execute('UPDATE provider_usage SET actual_tokens=?, status=? WHERE id=?',
                   (None if actual_tokens is None else int(actual_tokens), status, usage_id))
    finally:
        db.close()


def summary(provider='groq'):
    now = time.time()
    db = _db()
    try:
        day = db.execute(
            'SELECT COUNT(*) n, COALESCE(SUM(COALESCE(actual_tokens, reserved_tokens)),0) t FROM provider_usage '
            'WHERE provider=? AND day=?', (provider, _today(now))).fetchone()
    finally:
        db.close()
    return {'requests_today': day['n'], 'tokens_today': day['t'],
            'daily_request_budget': settings.groq_daily_requests, 'daily_token_budget': settings.groq_daily_tokens,
            'per_user_daily_requests': settings.groq_user_daily_requests}
