"""Groq provider: request format, failures, quota and privacy. HTTP is mocked; no quota is used."""
import asyncio
import json
import threading

import httpx
import pytest

from app import llm, provider_quota, rag
from app.config import settings

KEY = 'gsk_' + 'A1b2' * 12
SOURCES = [{'citation': 1, 'file_id': 'f1', 'filename': 'a.txt', 'section': 'Content',
            'passage': 'The retention code is ORCHID-4471.'},
           {'citation': 2, 'file_id': 'f2', 'filename': 'b.txt', 'section': 'Content',
            'passage': 'Originals are stored privately in Amazon S3.'}]


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, 'data_dir', tmp_path)
    key_file = tmp_path / 'groq-api-key'
    key_file.write_text(KEY)
    monkeypatch.setattr(settings, 'groq_api_key_file', key_file)
    monkeypatch.setattr(settings, 'groq_model', 'openai/gpt-oss-20b')
    yield


class FakeClient:
    """Replaces httpx.AsyncClient; records requests and replays canned responses."""
    calls = []
    responses = []

    def __init__(self, *args, **kwargs):
        FakeClient.init = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None, headers=None):
        FakeClient.calls.append({'url': url, 'json': json, 'headers': headers})
        item = FakeClient.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def reply(status=200, body=None, headers=None):
    return httpx.Response(status, json=body or {}, headers=headers or {})


def ok_body(content):
    return {'model': 'openai/gpt-oss-20b', 'choices': [{'message': {'content': content}, 'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': 500, 'completion_tokens': 80, 'total_tokens': 580}}


@pytest.fixture
def fake(monkeypatch):
    FakeClient.calls, FakeClient.responses = [], []
    monkeypatch.setattr(llm.httpx, 'AsyncClient', FakeClient)
    return FakeClient


def run(coro):
    return asyncio.run(coro)


def test_request_uses_fixed_endpoint_strict_schema_and_no_redirects(fake):
    answer = json.dumps({'insufficient': False, 'claims': [
        {'text': 'The retention code is ORCHID-4471.', 'sources': [1], 'quotes': ['The retention code is ORCHID-4471.']}]})
    fake.responses = [reply(200, ok_body(answer), {'x-ratelimit-remaining-requests': '999'})]
    result, timing = run(llm.generate('What is the retention code?', SOURCES[:1], provider='groq', actor='u1'))
    assert result.claims[0].sources == [1]
    assert fake.init['base_url'] == 'https://api.groq.com/openai/v1'
    assert fake.init['follow_redirects'] is False and fake.init['verify'] is True
    body = fake.calls[0]['json']
    assert body['response_format']['json_schema']['strict'] is True
    assert body['reasoning_effort'] == 'low' and body['temperature'] == 0
    assert 'f2' not in json.dumps(body) and 'Amazon S3' not in json.dumps(body)   # only given sources
    assert timing['provider'] == 'groq' and timing['total_tokens'] == 580
    assert provider_quota.summary()['tokens_today'] == 580


@pytest.mark.parametrize('status,code', [(401, 'credentials'), (403, 'credentials'), (429, 'rate_limited')])
def test_auth_and_rate_limit_errors_cool_down_without_retry_or_key_leak(fake, status, code):
    fake.responses = [reply(status, {'error': {'message': 'bad key ' + KEY}}, {'retry-after': '7'})]
    with pytest.raises(llm.ProviderError) as error:
        run(llm.generate('q?', SOURCES[:1], provider='groq', actor='u1'))
    assert error.value.code == code and KEY not in str(error.value) and KEY not in error.value.message
    assert len(fake.calls) == 1
    assert llm.groq_status()['available'] is False          # cooldown in effect
    with pytest.raises(llm.ProviderError) as again:
        run(llm.generate('q?', SOURCES[:1], provider='groq', actor='u1'))
    assert again.value.code == 'cooldown' and len(fake.calls) == 1   # no request sent during cooldown


def test_server_error_retries_once_then_reports_unavailable(fake, monkeypatch):
    monkeypatch.setattr(llm, 'asyncio', __import__('asyncio'), raising=False)
    fake.responses = [reply(503), reply(503)]
    with pytest.raises(llm.ProviderError) as error:
        run(llm.generate('q?', SOURCES[:1], provider='groq', actor='u1'))
    assert error.value.code == 'unavailable' and len(fake.calls) == 2


def test_network_failure_keeps_reservation_and_retries_once(fake):
    fake.responses = [httpx.ConnectTimeout('slow'), httpx.ConnectTimeout('slow')]
    with pytest.raises(llm.ProviderError):
        run(llm.generate('q?', SOURCES[:1], provider='groq', actor='u1'))
    usage = provider_quota.summary()
    assert usage['requests_today'] == 2 and usage['tokens_today'] > 0   # ambiguous consumption counted


@pytest.mark.parametrize('content', ['', 'not json', '{"insufficient": false}'])
def test_malformed_or_empty_output_is_rejected(fake, content):
    fake.responses = [reply(200, ok_body(content))]
    with pytest.raises(llm.ProviderError) as error:
        run(llm.generate('q?', SOURCES[:1], provider='groq', actor='u1'))
    assert error.value.code == 'malformed'


def test_missing_key_is_reported_without_network(fake, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, 'groq_api_key_file', tmp_path / 'absent')
    assert llm.groq_status()['available'] is False
    with pytest.raises(llm.ProviderError) as error:
        run(llm.generate('q?', SOURCES[:1], provider='groq', actor='u1'))
    assert error.value.code == 'not_configured' and fake.calls == []


def test_quota_budgets_are_enforced_per_user_and_globally(monkeypatch):
    monkeypatch.setattr(settings, 'groq_user_daily_requests', 2)
    provider_quota.reserve('u1', 10, 'generation')
    provider_quota.reserve('u1', 10, 'generation')
    with pytest.raises(provider_quota.QuotaExceeded):
        provider_quota.reserve('u1', 10, 'generation')
    provider_quota.reserve('u2', 10, 'generation')                  # other users unaffected
    monkeypatch.setattr(settings, 'groq_minute_tokens', 100)
    with pytest.raises(provider_quota.QuotaExceeded):
        provider_quota.reserve('u3', 500, 'generation')             # token budget


def test_concurrent_reservations_never_exceed_the_minute_budget(monkeypatch):
    monkeypatch.setattr(settings, 'groq_minute_requests', 5)
    granted, threads = [], []

    def worker(i):
        try:
            provider_quota.reserve(f'user{i}', 10, 'generation')
            granted.append(i)
        except provider_quota.QuotaExceeded:
            pass

    for i in range(20):
        threads.append(threading.Thread(target=worker, args=(i,)))
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(granted) == 5


def test_only_externally_permitted_passages_reach_groq(monkeypatch):
    monkeypatch.setattr(settings, 'llm_provider', 'groq')
    monkeypatch.setattr(settings, 'ollama_fallback_enabled', False)
    ask = rag.Ask(question='Where are originals stored?', file_ids=['f1', 'f2'], external_file_ids=['f2'])
    provider, sources, notice = rag.choose_provider(ask, SOURCES)
    assert provider == 'groq' and [s['file_id'] for s in sources] == ['f2'] and 'withheld' in notice
    none = rag.Ask(question='Where are originals stored?', file_ids=['f1', 'f2'], external_file_ids=[])
    provider, sources, notice = rag.choose_provider(none, SOURCES)
    assert provider is None and sources == [] and 'not permitted' in notice
    monkeypatch.setattr(settings, 'ollama_fallback_enabled', True)
    provider, sources, _ = rag.choose_provider(none, SOURCES)
    assert provider == 'ollama' and len(sources) == 2                 # private local fallback only
    local = rag.Ask(question='q?', file_ids=['f1'], external_file_ids=['f1'], provider='local')
    assert rag.choose_provider(local, SOURCES)[0] == 'ollama'


def test_default_configuration_keeps_private_local_generation():
    assert settings.llm_provider == 'ollama'
    ask = rag.Ask(question='q?', file_ids=['f1'], external_file_ids=['f1'])
    assert rag.choose_provider(ask, SOURCES)[0] == 'ollama'


def test_default_key_path_matches_windows_key_setup_helper():
    from app.config import Settings, ROOT
    configured = Settings(_env_file=None, groq_api_key_file=None)
    assert configured.groq_api_key_file == ROOT.parent / ".runtime/secrets/groq-api-key"
