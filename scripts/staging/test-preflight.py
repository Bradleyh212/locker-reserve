import importlib.util
from pathlib import Path
import unittest
import tempfile
import os
spec = importlib.util.spec_from_file_location('preflight', Path(__file__).with_name('preflight.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
class ConfigBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='staging-preflight-fixture-')
        folder = Path(cls.directory.name)
        (folder/'api.json').write_text('{}')
        (folder/'db-password').write_text('fixture-only')
        (folder/'compose.env').write_text(f'RELEASE_ID=fixture\nWEB_DOMAIN=staging.example.test\nAPI_DOMAIN=api-staging.example.test\nACME_EMAIL=fixture@example.test\nNEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_fixture\nAPI_CONFIG_FILE={folder}/api.json\nDB_PASSWORD_FILE={folder}/db-password\n')
        cls.env = {**os.environ, 'STAGING_ENV_FILE': str(folder/'compose.env')}
    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()
    def setUp(self):
        import json, subprocess
        self.c = json.loads(subprocess.check_output(['sh', str(Path(__file__).with_name('compose.sh')), '--profile', 'tools', 'config', '--format', 'json'], env=self.env))
    def test_valid(self):
        self.assertTrue(p.verify(self.c))
    def test_no_public_database(self):
        self.c['services']['db']['ports'] = [{'published':'5432','target':5432}]
        with self.assertRaises(AssertionError): p.verify(self.c)
    def test_no_live_stripe(self):
        self.c['services']['web']['build']['args']['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'] = 'pk_live_fixture'
        with self.assertRaises(AssertionError): p.verify(self.c)
    def test_no_global_allowlist(self):
        self.c['services']['caddy']['environment']['STAGING_ALLOWED_CIDRS'] = '0.0.0.0/0'
        with self.assertRaises(AssertionError): p.verify(self.c)
    def test_proxy_mismatch(self):
        self.c['services']['api']['environment']['TRUSTED_PROXY_IP'] = '172.30.88.99'
        with self.assertRaises(AssertionError): p.verify(self.c)
    def test_proxy_not_in_dynamic_pool(self):
        self.c['networks']['proxy']['ipam']['config'][0]['ip_range'] = '172.30.88.0/24'
        with self.assertRaises(AssertionError): p.verify(self.c)
    def test_pulses_disabled(self):
        self.c['services']['api']['environment']['CUSTOMER_UNLOCK_PULSE_MS'] = '5000'
        with self.assertRaises(AssertionError): p.verify(self.c)
if __name__ == '__main__': unittest.main()
