#!/usr/bin/env python3
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('dev', Path(__file__).with_name('dev-supervisor.py'))
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)

class DevTests(unittest.TestCase):
    def test_env_preserves_literal_secrets_and_spaces(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'.env'; p.write_text('HASH=$2b$literal\nPATH="/a path/key"\nPORT=3001 # note\n')
            self.assertEqual(dev.read_env(p), {'HASH':'$2b$literal','PATH':'/a path/key','PORT':'3001'})

    def test_conflicting_port_is_not_killed(self):
        with patch.object(dev,'listener',return_value='unrelated PID'), patch.object(dev.os,'killpg') as kill:
            with self.assertRaisesRegex(RuntimeError,'already owned'): dev.require_free([3000])
            kill.assert_not_called()

    def test_foreign_container_is_not_removed(self):
        item=[{'Config':{'Labels':{}},'State':{'Status':'running'}}]
        with patch.object(dev,'command',return_value=json.dumps(item)) as run:
            with self.assertRaisesRegex(RuntimeError,'not identify'): dev.legacy_containers(clean=True)
            self.assertEqual(run.call_count,1)

    def test_stop_does_not_signal_reused_pid(self):
        data={'root':str(dev.ROOT),'supervisor':123,'identity':'old dev-supervisor.py'}
        with patch.object(dev,'load_state',return_value=data), patch.object(dev,'identity',return_value='new process'), patch.object(dev.os,'kill') as kill:
            dev.stop(); kill.assert_not_called()

    def test_cleanup_terminates_owned_group_only(self):
        with tempfile.TemporaryDirectory() as t:
            oldstate,oldchildren=dev.STATE,dev.CHILDREN
            dev.STATE=Path(t);dev.CHILDREN=[]
            unrelated=subprocess.Popen(['sleep','60'])
            try:
                child=dev.spawn('test',['sh','-c','sleep 60 & wait'],dev.ROOT,os.environ.copy())
                dev.cleanup()
                self.assertIsNotNone(child.poll())
                self.assertIsNone(unrelated.poll())
            finally:
                unrelated.terminate();unrelated.wait()
                dev.STATE,dev.CHILDREN=oldstate,oldchildren

    def test_health_requires_matching_run(self):
        from io import BytesIO
        class Response(BytesIO):
            status=200
        with patch('urllib.request.urlopen',return_value=Response(b'{"service":"locker-reserve-api","status":"ok","runId":"old"}')):
            self.assertFalse(dev.healthy('http://localhost:3001/health','new'))

if __name__=='__main__': unittest.main()
