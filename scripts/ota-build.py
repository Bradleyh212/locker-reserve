#!/usr/bin/env python3
"""Build a public app image or a private USB bootstrap. Never uploads."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location('cloud', Path(__file__).with_name('firmware-cloud.py'))
cloud = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloud)


def header(build, sha, profile):
    version = f'ota-{build}-{sha[:12]}'
    seed = ''
    if profile:
        v = cloud.profile_values(profile)
        namespace = 'cloud-' + hashlib.sha256((v['API_BASE_URL'] + '/' + v['DEVICE_ID']).encode()).hexdigest()[:9]
        private = dict(ssid=v['WIFI_SSID'], password=v['WIFI_PASSWORD'], token=v['DEVICE_TOKEN'],
                       device=v['DEVICE_ID'], locker=v['LOCKER_ID'], journal=namespace)
        seed = '#define OTA_USB_PROFILE ' + json.dumps(json.dumps(private)) + '\n'
    marker = 'LR_USB_PRIVATE' if profile else f'LR_OTA_APP:{version}:{build}:'
    return '#pragma once\n' + seed + f'''#include "ota_identity.h"
#define OTA_ENABLED 1
#define FIRMWARE_VERSION "{version}"
#define FIRMWARE_BUILD {build}
#define OTA_IMAGE_MARKER "{marker}"
#define WIFI_SSID locker::identity::ssid.c_str()
#define WIFI_PASSWORD locker::identity::password.c_str()
#define DEVICE_TOKEN locker::identity::token.c_str()
#define DEVICE_ID locker::identity::device.c_str()
#define LOCKER_ID locker::identity::lockerId.c_str()
#define COMMAND_JOURNAL_NAMESPACE locker::identity::journal.c_str()
#define ACTUATION_ENABLED false
#define MAX_PULSE_MS 0
#define API_BASE_URL "https://{cloud.HOST}"
#define API_CA_PEM R"LR_CA({cloud.trust_bundle()})LR_CA"
'''


def validate(directory):
    raw = (directory / 'src.ino.partitions.bin').read_bytes()
    slots = {}
    for magic, kind, sub, offset, size in struct.iter_unpack('<HBBII20x', raw):
        if magic == 0x50aa:
            slots[kind, sub] = (offset, size)
    if any(slots.get(key) != expected for key, expected in [
        ((1, 0), (0xe000, 0x2000)), ((0, 16), (0x10000, 0x140000)),
        ((0, 17), (0x150000, 0x140000))]):
        raise ValueError('Unexpected ESP32 OTA layout')
    image = (directory / 'src.ino.bin').read_bytes()
    if not 288 < len(image) <= 0x140000 or image[0] != 0xe9 or image[12:14] != bytes(2) or image[32:36] != bytes.fromhex('3254cdab'):
        raise ValueError('Expected classic ESP32 application fitting both OTA slots')
    return image


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--build', required=True, type=int)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--usb-profile', type=Path, help='Private USB bootstrap only')
    args = p.parse_args()
    if not 1 <= args.build < 2**31 or (args.usb_profile and args.build != 1):
        p.error('Use build 1 for USB and an increasing positive integer for OTA')
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    config = header(args.build, sha, args.usb_profile)
    if args.usb_profile:
        cloud.build(config, args.output, 'arduino-cli')
        validate(args.output)
        return
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp) / 'compile'
        try:
            cloud.build(config, directory, 'arduino-cli')
        except ValueError:
            print((directory / 'compile.log').read_text())  # public build only
            raise
        image = validate(directory)
    name = f'ota-{args.build}-{sha[:12]}.bin'
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / name).write_bytes(image)
    (args.output / 'SHA256SUMS').write_text(f'{hashlib.sha256(image).hexdigest()}  {name}\n')
    print(f'{name}: {len(image)} / 1310720 bytes; both OTA partitions verified')


if __name__ == '__main__':
    main()
