"""Exercise the release journal and rollback boundaries without an SSH or Docker connection."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cd


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.folder = Path(directory.name)
        self.sha = 'a' * 40
        self.old_sha = 'b' * 40
        self.digest = 'sha256:' + '1' * 64
        self.previous = {s: 'rollback-' + s + ':' + '2' * 64 for s in cd.APPS}
        self.refs = cd.parse('deploy ' + self.sha + (' ' + self.digest) * 3)[1]
        self.enterContext(patch.object(cd, 'STATE', self.folder))
        self.enterContext(patch.object(cd, 'CONFIG', self.folder))
        for name in ('preflight', 'snapshot', 'migrations', 'backup_release', 'main_head',
                     'compose', 'switch', 'iid', 'verify_apps'):
            setattr(self, name, self.enterContext(patch.object(cd, name)))
        self.snapshot.return_value = self.previous, self.old_sha
        self.migrations.return_value = []
        self.backup_release.return_value = str(self.folder / 'backup')
        self.iid.return_value = 'sha256:' + '2' * 64

    def deploy(self):
        cd.deploy(self.sha, self.refs)

    def test_exact_immutable_requests_only(self):
        for invalid in ['rollback', 'deploy main ' + self.digest, 'deploy ' + self.sha + ' latest latest latest',
                        'deploy ' + self.sha + (' ' + self.digest) * 3 + ' ; id']:
            with self.assertRaises(cd.ReleaseError):
                cd.parse(invalid)

    def test_healthy_release_and_retry(self):
        self.deploy()
        self.deploy()
        self.assertEqual(cd.read('release.json')['active_sha'], self.sha)
        self.switch.assert_called_once_with(self.refs)
        self.verify_apps.assert_called_once_with(self.refs)

    def test_bad_backup_and_superseded_head_leave_apps_running(self):
        for stop in (self.backup_release, self.main_head):
            stop.side_effect = cd.ReleaseError('refused')
            with self.assertRaises(cd.ReleaseError):
                self.deploy()
            stop.side_effect = None
            self.switch.assert_not_called()
            self.compose.assert_not_called()
            self.assertIsNone(cd.read('release.json'))

    def test_unreviewed_migration(self):
        self.migrations.return_value = ['new_migration']
        with self.assertRaises(cd.ReleaseError):
            self.deploy()
        self.backup_release.assert_not_called()
        self.compose.assert_not_called()

    def test_failed_migration_holds_for_operator(self):
        self.compose.side_effect = cd.ReleaseError('migration error')
        with self.assertRaises(cd.ReleaseError):
            self.deploy()
        self.assertEqual(cd.read('release.json')['phase'], 'migrating')
        with self.assertRaises(cd.ReleaseError):
            self.deploy()
        self.switch.assert_not_called()
        self.compose.assert_called_once()

    def test_failed_health_restores_previous_pair(self):
        self.switch.side_effect = [cd.ReleaseError('unhealthy'), None]
        with self.assertRaises(cd.ReleaseError):
            self.deploy()
        self.assertEqual([c.args[0] for c in self.switch.call_args_list], [self.refs, self.previous])
        self.assertEqual(cd.read('release.json')['active_sha'], self.old_sha)
        self.assertEqual(cd.read('release.json')['phase'], 'rolled-back')

    def test_failed_recovery_holds_for_operator(self):
        self.switch.side_effect = cd.ReleaseError('failed health')
        with self.assertRaises(cd.ReleaseError):
            self.deploy()
        self.assertEqual(cd.read('release.json')['phase'], 'switching')

    def test_replaced_local_image_stops_rollback(self):
        self.deploy()
        self.iid.return_value = self.digest
        with self.assertRaises(cd.ReleaseError):
            cd.rollback(cd.read('release.json'))
        self.switch.assert_called_once_with(self.refs)


if __name__ == '__main__':
    unittest.main()
