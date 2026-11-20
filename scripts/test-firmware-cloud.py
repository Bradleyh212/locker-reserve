#!/usr/bin/env python3
"""Private-profile regression tests; no hosted traffic or hardware."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('cloud', Path(__file__).with_name('firmware-cloud.py'))
cloud = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloud)


class Profiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.profile = self.folder / 'profile.json'
        self.token = self.folder / 'token'
        cloud.private_write(self.token, 'a' * 64 + '\n')
        self.data = dict(wifi_ssid='quoted"\\network', wifi_password='fixture-password',
                         device_id='staging-simulated', locker_id='12345678-1234-1234-1234-123456789abc',
                         token_file='token')
        cloud.private_write(self.profile, json.dumps(self.data))

    def test_profile_is_private_non_actuating_and_escaped(self):
        header = cloud.render(self.profile)
        self.assertIn('#define ACTUATION_ENABLED false', header)
        self.assertIn('#define MAX_PULSE_MS 0', header)
        self.assertIn('https://api-staging.lockerreserve.com', header)
        self.assertIn(json.dumps(self.data['wifi_ssid']), header)
        self.assertEqual(header.count('BEGIN CERTIFICATE'), 2)
        self.assertEqual(os.stat(self.profile).st_mode & 0o777, 0o600)

    def test_cloud_journal_is_stable_and_separate_from_mac(self):
        first = cloud.render(self.profile)
        journal = [line for line in first.splitlines() if 'COMMAND_JOURNAL_NAMESPACE' in line][0]
        self.assertNotIn('locker-api', journal)
        self.assertIn(journal, cloud.render(self.profile))
        self.data['device_id'] = 'another-staging-identity'
        self.profile.write_text(json.dumps(self.data))
        self.assertNotIn(journal, cloud.render(self.profile))

    def test_build_is_isolated_and_never_uploads(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        output = self.folder / 'build'
        def compile_stub(command, **kwargs):
            self.assertEqual(command[:4], ['fixture-cli', 'compile', '--fqbn', 'esp32:esp32:esp32'])
            copied = Path(command[-1]).parent / 'include/config.local.h'
            self.assertEqual(copied.read_text(), cloud.render(self.profile))
            self.assertNotIn('--port', command)
            self.assertNotIn('upload', command)
            (output / 'fixture.bin').write_bytes(b'fixture')
            return SimpleNamespace(returncode=0)
        with patch.object(cloud.subprocess, 'run', side_effect=compile_stub):
            cloud.build(cloud.render(self.profile), output, 'fixture-cli')
        self.assertEqual((output / 'fixture.bin').stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            cloud.build('replacement', output, 'fixture-cli')

    def test_hosted_probe_requires_approval_and_simulated_identity(self):
        from unittest.mock import patch
        with patch.object(cloud.http.client, 'HTTPSConnection') as network:
            with self.assertRaises(ValueError):
                cloud.probe(self.profile, False)
            with self.assertRaises(ValueError):
                cloud.probe(self.profile, True)
            network.assert_not_called()

    def test_simulator_acceptance_never_submits_unlock_or_results(self):
        from unittest.mock import patch, MagicMock
        self.data['device_id'] = 'esp32-staging-sim-fixture'
        self.profile.write_text(json.dumps(self.data))
        requests = []
        def connection(*args, **kwargs):
            client = MagicMock()
            def send(method, path, body, headers):
                requests.append((method, path, body))
                response = MagicMock()
                response.status = 200 if method == 'POST' else 204
                response.read.return_value = b'{"accepted":true}' if method == 'POST' else b''
                client.getresponse.return_value = response
            client.request.side_effect = send
            return client
        with patch.object(cloud.http.client, 'HTTPSConnection', side_effect=connection), \
             patch.object(cloud.time, 'sleep'), patch('builtins.print'):
            cloud.probe(self.profile, True)
        self.assertEqual(len(requests), 6)
        heartbeats = [json.loads(body) for method, _, body in requests if method == 'POST']
        self.assertEqual([b['doorState'] for b in heartbeats], ['CLOSED', 'OPEN', 'CLOSED'])
        self.assertTrue(all(b['actuationEnabled'] is False and b['maxPulseMs'] == 0 for b in heartbeats))
        self.assertTrue(all(path in ['/v1/device/heartbeat', '/v1/device/commands/next'] for _, path, _ in requests))

    def test_simulator_stops_on_unexpected_command_and_prints_no_body(self):
        from unittest.mock import patch, MagicMock
        self.data['device_id'] = 'esp32-staging-sim-fixture'
        self.profile.write_text(json.dumps(self.data))
        response = MagicMock(status=200)
        response.read.side_effect = [b'{"accepted":true}', b'{"commandId":"sensitive-fixture"}']
        client = MagicMock()
        client.getresponse.return_value = response
        with patch.object(cloud.http.client, 'HTTPSConnection', return_value=client), patch('builtins.print') as output:
            with self.assertRaises(ValueError):
                cloud.probe(self.profile, True)
            output.assert_not_called()
        self.assertEqual(client.request.call_count, 2)

    def test_refuse_existing_output(self):
        with self.assertRaises(FileExistsError):
            cloud.private_write(self.profile, 'replacement')
        self.assertEqual(json.loads(self.profile.read_text()), self.data)

    def test_reject_public_or_symlinked_credentials(self):
        self.token.chmod(0o644)
        with self.assertRaises(ValueError):
            cloud.render(self.profile)
        self.token.chmod(0o600)
        link = self.folder / 'link'
        link.symlink_to(self.token)
        with self.assertRaises(OSError):
            cloud.private_read(link)

    def test_no_overrides_for_cloud_endpoint_or_actuation(self):
        for field, value in [('actuation_enabled', True), ('api_base_url', 'http://invalid')]:
            self.profile.write_text(json.dumps({**self.data, field: value}))
            with self.assertRaises(ValueError):
                cloud.render(self.profile)

    def test_invalid_or_missing_token_and_identity(self):
        self.token.write_text('local-token-not-a-provisioned-staging-credential')
        with self.assertRaises(ValueError):
            cloud.render(self.profile)
        self.token.unlink()
        with self.assertRaises(FileNotFoundError):
            cloud.render(self.profile)

    def test_trust_roots_are_fingerprint_checked(self):
        before = cloud.ROOTS.copy()
        self.addCleanup(lambda: setattr(cloud, 'ROOTS', before))
        cloud.ROOTS = {'isrg-root-x1.pem': '00' * 32}
        with self.assertRaises(ValueError):
            cloud.trust_bundle()


if __name__ == '__main__':
    unittest.main()
