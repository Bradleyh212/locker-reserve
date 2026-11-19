#!/usr/bin/env python3
"""Compile disposable sketches using only public example configuration."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cli', default='arduino-cli')
    parser.add_argument('--config-file', help='Optional local Arduino CLI configuration')
    args = parser.parse_args()
    cli = [args.cli]
    if args.config_file:
        cli += ['--config-file', args.config_file]
    with tempfile.TemporaryDirectory(prefix='locker-firmware-ci-') as tmp:
        firmware = Path(tmp) / 'firmware'
        shutil.copytree(ROOT / 'firmware', firmware,
                        ignore=shutil.ignore_patterns('config.local.h', 'build', '.pio', '__pycache__'))
        for folder in ('include', 'device-check'):
            shutil.copyfile(firmware / folder / 'config.example.h',
                            firmware / folder / 'config.local.h')
        for sketch in ('src', 'device-check', 'usb-check', 'reed-check'):
            print(f'Compiling {sketch} with example configuration', flush=True)
            subprocess.run(cli + ['compile', '--fqbn', 'esp32:esp32:esp32',
                                  str(firmware / sketch)], check=True, timeout=600)
        # Exercise the cloud trust bundle, scoped journal and zero-ceiling build
        # with public fixtures only. No private config or hardware is used.
        spec = importlib.util.spec_from_file_location('cloud', ROOT / 'scripts/firmware-cloud.py')
        cloud = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cloud)
        profile = Path(tmp) / 'profile.json'
        cloud.private_write(Path(tmp) / 'token', 'a' * 64 + '\n')
        cloud.private_write(profile, json.dumps(dict(
            wifi_ssid='SIMULATED-NO-HARDWARE', wifi_password='fixture-only',
            device_id='staging-simulated', locker_id='12345678-1234-1234-1234-123456789abc',
            token_file='token')))
        output = Path(tmp) / 'cloud-build'
        # Preserve optional Arduino CLI config support through a temporary wrapper.
        compiler = args.cli
        if args.config_file:
            import shlex
            wrapper = Path(tmp) / 'arduino-wrapper'
            wrapper.write_text('#!/bin/sh\nexec ' + shlex.join(cli) + ' "$@"\n')
            wrapper.chmod(0o700)
            compiler = str(wrapper)
        print('Compiling cloud profile with fixture credentials (actuation disabled)', flush=True)
        try:
            cloud.build(cloud.render(profile), output, compiler)
        except Exception:
            # This log contains exclusively the public fixture configuration.
            log = output / 'compile.log'
            if log.exists():
                print(log.read_text(), flush=True)
            raise


if __name__ == '__main__':
    main()
