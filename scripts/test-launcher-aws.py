"""Financial/startup failure regression tests; no AWS SDK calls or account mutations."""
import runpy
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

m = runpy.run_path(str(Path(__file__).with_name('launcher-aws.py')), run_name='launcher_tests')


class LauncherSafety(unittest.TestCase):
    def test_private_manifest_cannot_start_paid_session(self):
        c = {'PUBLIC_URL': None, 'start': Mock()}
        with self.assertRaisesRegex(RuntimeError, 'not configured'):
            m['start'](c)
        c['start'].assert_not_called()

    def test_public_url_requires_aws_https_hostname(self):
        for url in ['http://x.cloudfront.net', 'https://x.cloudfront.net.evil.test',
                    'https://user@x.cloudfront.net', 'http://127.0.0.1:3200']:
            with self.subTest(url=url), self.assertRaises(RuntimeError):
                m['public_url']({'PUBLIC_URL': url})

    def test_public_url_accepts_aws_api_gateway_and_rejects_lookalikes(self):
        self.assertEqual(m['public_url']({'PUBLIC_URL': 'https://abc123.execute-api.ap-southeast-2.amazonaws.com'}),
                         'https://abc123.execute-api.ap-southeast-2.amazonaws.com')
        for url in ['http://abc.execute-api.ap-southeast-2.amazonaws.com',
                    'https://abc.execute-api.ap-southeast-2.amazonaws.com.evil.test']:
            with self.assertRaises(RuntimeError):
                m['public_url']({'PUBLIC_URL': url})

    def test_public_url_accepts_genuine_cloudfront_format(self):
        url = 'https://example.cloudfront.net'
        self.assertEqual(m['public_url']({'PUBLIC_URL': url}), url)

    def test_transition_does_not_start_or_rearm(self):
        c = {'PUBLIC_URL': 'https://example.cloudfront.net',
             'instance': Mock(return_value=({'State': {'Name': 'pending'}}, {})), 'start': Mock()}
        with self.assertRaisesRegex(RuntimeError, 'transition'):
            m['start'](c)
        c['start'].assert_not_called()

    def test_stop_already_stopped_is_read_only(self):
        c = {'instance': Mock(return_value=({'State': {'Name': 'stopped'}}, {})),
             'stop': Mock(), 'run_remote': Mock()}
        m['stop'](c)
        c['stop'].assert_not_called()
        c['run_remote'].assert_not_called()

    def test_start_cannot_skip_explicit_confirmation(self):
        args = SimpleNamespace(hours=4, yes=True)
        c = {'PUBLIC_URL': 'https://example.cloudfront.net',
             'instance': Mock(return_value=({'State': {'Name': 'stopped'}}, {})),
             'args': args, 'start': Mock(side_effect=SystemExit('Not authorized'))}
        with patch('builtins.input', return_value='2'), self.assertRaises(SystemExit):
            m['start'](c)
        self.assertFalse(args.yes)
        self.assertEqual(args.hours, 2)

    def test_invalid_running_authorization_never_extends_session(self):
        g = m['start'].__globals__
        c = {'PUBLIC_URL': 'https://example.cloudfront.net',
             'instance': Mock(return_value=({'State': {'Name': 'running'}}, {})), 'start': Mock()}
        with patch.dict(g, active_authorization=Mock(side_effect=RuntimeError('expired'))):
            with self.assertRaisesRegex(RuntimeError, 'expired'):
                m['start'](c)
        c['start'].assert_not_called()

    def test_failed_warmup_stops_owned_instance(self):
        g = m['start'].__globals__
        c = {'PUBLIC_URL': 'https://example.cloudfront.net',
             'instance': Mock(return_value=({'State': {'Name': 'running'}}, {})),
             'run_remote': Mock(return_value=('Failed', 'FAIL warmup')), 'stop': Mock()}
        with patch.dict(g, active_authorization=Mock(return_value=(None, 900))):
            with self.assertRaisesRegex(RuntimeError, 'warmup failed'):
                m['start'](c)
        c['stop'].assert_called_once()

    def test_expired_host_deadline_has_no_remaining_runtime(self):
        now = datetime.now(timezone.utc)
        _, seconds = m['deadline']({'now': lambda: now},
                                  {'NimbusStopDeadline': (now-timedelta(minutes=1)).isoformat()})
        self.assertLess(seconds, 0)


if __name__ == '__main__':
    unittest.main()
