#!/usr/bin/env python3
"""Prepare/compile a private, non-actuating cloud profile. Never uploads firmware."""
import argparse
import getpass
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import stat
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
HOST = 'api-staging.lockerreserve.com'
ROOTS = {
    'isrg-root-x1.pem': '96bcec06264976f37460779acf28c5a7cfe8a3c0aae11a8ffcee05c0bddf08c6',
    'isrg-root-x2.pem': '69729b8e15a86efc177a57afb7171dfc64add28c2fca8cf1507e34453ccb1470',
}


def trust_bundle():
    parts = []
    for name, expected in ROOTS.items():
        pem = (ROOT / 'firmware/certs' / name).read_text()
        der = ssl.PEM_cert_to_DER_cert(pem)
        if hashlib.sha256(der).hexdigest() != expected:
            raise ValueError('Public trust root fingerprint mismatch')
        parts.append(pem.strip() + '\n')
    return ''.join(parts)


def private_read(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise ValueError('Private input must be a regular file with mode 0600 or stricter')
        with os.fdopen(fd, encoding='utf-8', closefd=False) as stream:
            return stream.read()
    finally:
        os.close(fd)


def private_write(path, content):
    # Exclusive create: an existing Mac configuration/credential is never replaced.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def profile_values(profile):
    data = json.loads(private_read(profile))
    if set(data) != {'wifi_ssid', 'wifi_password', 'device_id', 'locker_id', 'token_file'}:
        raise ValueError('Unexpected or missing profile fields')
    if any(not isinstance(v, str) or not v or '\0' in v for v in data.values()):
        raise ValueError('Profile values must be nonempty strings without NUL')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', data['device_id']):
        raise ValueError('Invalid device identity')
    if not re.fullmatch(r'[0-9a-fA-F-]{36}', data['locker_id']):
        raise ValueError('Expected the hosted locker UUID, not its display code')
    token_path = Path(data['token_file'])
    if not token_path.is_absolute():
        token_path = profile.parent / token_path
    token = private_read(token_path).strip()
    if not re.fullmatch(r'[0-9a-f]{64}', token):
        raise ValueError('Expected a separately provisioned 32-byte hex staging token')
    return {
        'WIFI_SSID': data['wifi_ssid'], 'WIFI_PASSWORD': data['wifi_password'],
        'API_BASE_URL': 'https://' + HOST, 'DEVICE_ID': data['device_id'],
        'LOCKER_ID': data['locker_id'], 'DEVICE_TOKEN': token,
    }


def render(profile):
    values = profile_values(profile)
    lines = ['#pragma once', '// Generated cloud profile; private. Never commit or share.']
    lines += [f'#define {k} {json.dumps(v, ensure_ascii=True)}' for k, v in values.items()]
    namespace = 'cloud-' + hashlib.sha256(('https://' + HOST + '/' + values['DEVICE_ID']).encode()).hexdigest()[:9]
    lines += ['#define COMMAND_JOURNAL_NAMESPACE ' + json.dumps(namespace),
              '#define ACTUATION_ENABLED false', '#define MAX_PULSE_MS 0',
              '#define API_CA_PEM R"LR_CA(' + trust_bundle() + ')LR_CA"', '']
    return '\n'.join(lines)


def check_tls():
    # No HTTP/authentication: this cannot create device events or records.
    context = ssl.create_default_context(cadata=trust_bundle())
    # Exercise TLS 1.2, which is available on the pinned ESP32 core.
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.maximum_version = ssl.TLSVersion.TLSv1_2
    with socket.create_connection((HOST, 443), timeout=10) as tcp:
        with context.wrap_socket(tcp, server_hostname=HOST) as tls:
            cert = tls.getpeercert()
            print(f'TLS verified: {HOST}; {tls.version()}; leaf expires {cert["notAfter"]}')


def probe(profile, approved, expect_rejected=False):
    """Approved hosted simulator only; never queues or executes any command."""
    if not approved:
        raise ValueError('Hosted simulator writes require explicit operator approval')
    values = profile_values(profile)
    if not values['DEVICE_ID'].startswith('esp32-staging-sim-'):
        raise ValueError('Probe is restricted to clearly labeled simulated identities')
    context = ssl.create_default_context(cadata=trust_bundle())
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.maximum_version = ssl.TLSVersion.TLSv1_2
    headers = {'Authorization': 'Bearer ' + values['DEVICE_TOKEN'],
               'Content-Type': 'application/json'}
    boot = uuid.uuid4().hex
    started = time.monotonic()
    def send(method, path, body=None):
        connection = http.client.HTTPSConnection(HOST, timeout=10, context=context)
        try:
            connection.request(method, path, body, headers)
            response = connection.getresponse()
            payload = response.read(4097)
            if len(payload) > 4096:
                raise ValueError('Unexpected response size')
            return response.status, payload
        finally:
            connection.close()
    if expect_rejected:
        status, _ = send('GET', '/v1/device/commands/next')
        if status != 401:
            raise ValueError('Expected revoked/invalid credential rejection')
        print('Simulated credential rejected (401). No response body or token printed.')
        return
    for door in ['CLOSED', 'OPEN', 'CLOSED']:
        body = dict(doorState=door, observedAtMs=int(time.time() * 1000),
                    outputState='INACTIVE', firmwareVersion='staging-sim-no-hardware',
                    actuationEnabled=False, maxPulseMs=0,
                    diagnostics=dict(bootId=boot, uptimeMs=int((time.monotonic() - started) * 1000),
                                     resetReason='POWERON', wifiDisconnects=0, communicationFailures=0))
        status, payload = send('POST', '/v1/device/heartbeat', json.dumps(body))
        ack = json.loads(payload) if status == 200 else {}
        if status != 200 or ack.get('accepted') is not True or ack.get('ignored') is True:
            raise ValueError('Hosted heartbeat not accepted; stop and inspect privately')
        status, _ = send('GET', '/v1/device/commands/next')
        if status != 204:
            # Never report a synthetic completion or echo a command response.
            raise ValueError('Unexpected command polling response; stop for review')
        print(f'Simulated contact {door} accepted; command polling 204; no output activated.')
        time.sleep(0.05)


def build(config, output, cli):
    # Retain artifacts privately; refuse replacement. No serial discovery/upload.
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    try:
        with tempfile.TemporaryDirectory(prefix='locker-cloud-') as tmp:
            firmware = Path(tmp) / 'firmware'
            shutil.copytree(ROOT / 'firmware', firmware,
                            ignore=shutil.ignore_patterns('config.local.h', 'build', '.pio'))
            private_write(firmware / 'include/config.local.h', config)
            with open(output / 'compile.log', 'x', opener=lambda p, f: os.open(p, f, 0o600)) as log:
                result = subprocess.run([cli, 'compile', '--fqbn', 'esp32:esp32:esp32',
                                         '--output-dir', str(output), str(firmware / 'src')],
                                        stdout=log, stderr=subprocess.STDOUT, timeout=600)
            if result.returncode:
                raise ValueError('Compilation failed; review the private compile.log locally')
        print('Compiled esp32:esp32:esp32. Private artifacts saved; nothing uploaded.')
    finally:
        # Binaries embed credentials too. Do not publish these artifacts or logs.
        for file in output.rglob('*'):
            if file.is_file():
                file.chmod(0o600)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['init', 'check-tls', 'render', 'build', 'probe'])
    parser.add_argument('--profile', type=Path, default=ROOT / '.device-local/cloud/profile.json')
    parser.add_argument('--output', type=Path, help='New private header file or new build directory')
    parser.add_argument('--local-config', type=Path, help='Compile an existing Mac config without replacing it')
    parser.add_argument('--cli', default='arduino-cli')
    parser.add_argument('--approved-hosted-simulation', action='store_true',
                        help='Only after explicit approval for persistent hosted simulator writes')
    parser.add_argument('--expect-rejected', action='store_true', help='Probe revoked/invalid simulated token')
    args = parser.parse_args()
    if args.operation == 'probe':
        probe(args.profile, args.approved_hosted_simulation, args.expect_rejected)
        return
    if args.operation == 'check-tls':
        check_tls()
        return
    if args.operation == 'init':
        if args.local_config:
            raise ValueError('Local config is only accepted by build')
        args.profile.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        data = {'wifi_ssid': input('Wi-Fi name: '), 'wifi_password': getpass.getpass('Wi-Fi password: '),
                'device_id': input('Dedicated hosted device ID: '), 'locker_id': input('Hosted locker UUID: '),
                'token_file': input('Private staging token file (not the Mac token): ')}
        private_write(args.profile, json.dumps(data, indent=2) + '\n')
        print('Private profile saved. No hosted records created.')
        return
    if not args.output:
        raise ValueError('Supply a new --output path')
    if args.local_config and args.operation != 'build':
        raise ValueError('Local config is only accepted by build')
    config = private_read(args.local_config) if args.local_config else render(args.profile)
    if args.operation == 'render':
        private_write(args.output, config)
        print('Private cloud header saved; actuation disabled with a zero ceiling.')
    else:
        build(config, args.output.resolve(), args.cli)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Inputs/tool errors may contain Wi-Fi credentials: no arbitrary exception echo.
        print('Cloud preparation failed. Check private file permissions, profile fields, token file, TLS/network, and build log.')
        raise SystemExit(1)
