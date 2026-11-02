#!/usr/bin/env python3
"""Compile disposable sketches using only public example configuration."""
import argparse
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


if __name__ == '__main__':
    main()
