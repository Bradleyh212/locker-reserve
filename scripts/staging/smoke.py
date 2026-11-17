#!/usr/bin/env python3
"""Fixture-only HTTPS checks; refuses remote hosts and non-test Compose projects.
Run against the runbook's disposable localhost stack, never the Mac API or server.
"""
import argparse
import base64
import datetime as dt
import hashlib
import hmac
import http.client
import json
import os
import socket
import ssl
import subprocess
import time
import uuid
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--ca', required=True)
parser.add_argument('--https-port', type=int, default=58443)
parser.add_argument('--http-port', type=int, default=58080)
a = parser.parse_args()
if os.environ.get('STAGING_PROJECT_NAME') != 'locker-staging-validation':
    raise SystemExit('Only disposable test projects allowed')
context = ssl.create_default_context(cafile=a.ca)
context.minimum_version = ssl.TLSVersion.TLSv1_2
class LocalHTTPS(http.client.HTTPSConnection):
    def connect(self):
        self.sock = context.wrap_socket(socket.create_connection(('127.0.0.1', self.port), timeout=10), server_hostname=self.host)

def request(path, method='GET', body=None, headers=None, api=False):
    connection = LocalHTTPS('api-staging.localhost' if api else 'staging.localhost', a.https_port, context=context)
    payload = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
    connection.request(method, path, body=payload, headers={'Content-Type':'application/json', **(headers or {})})
    response = connection.getresponse()
    data, fields = response.read(), dict((k.lower(),v) for k,v in response.getheaders())
    connection.close()
    return response.status, fields, data

def check(condition, message):
    if not condition: raise AssertionError(message)
    print('PASS', message)

status, headers, _ = request('/api/health')
check(status == 200, 'HTTPS API readiness (PostgreSQL and Redis)')
check(headers.get('access-control-allow-origin') == 'https://staging.localhost', 'Exact CORS origin')
check(request('/book')[0] == 200, 'Production booking page behind verified TLS')
connection = http.client.HTTPConnection('127.0.0.1', a.http_port)
connection.request('GET', '/book', headers={'Host':'staging.localhost'})
response = connection.getresponse()
check(response.status == 308 and response.getheader('Location') == 'https://staging.localhost/book', 'HTTP redirects to HTTPS')
response.read(); connection.close()
check(request('/api/auth/me')[0] == 401, 'Admin requires application authentication')
status, fields, data = request('/api/auth/login', 'POST', {'email':'fixture@example.test','password':'fixture-password-123'})
check(status == 201, 'Fixture administrator can sign in')
cookie = fields.get('set-cookie', '')
check(all(v in cookie.lower() for v in ['secure','httponly','samesite=lax']), 'Secure HttpOnly SameSite cookie')
check(request('/api/auth/me', headers={'Cookie':cookie.split(';')[0]})[0] == 200, 'Admin session works through same-origin API')
check(request('/v1/device/commands/next', api=True)[0] == 401, 'Device token still required')
# Verify the reverse proxy preserves the exact bytes Stripe signs, including whitespace.
payload = json.dumps({'id':'evt_fixture_'+uuid.uuid4().hex,'object':'event','type':'fixture.ignored','livemode':False,'data':{'object':{}}}, indent=2).encode()
timestamp = str(int(time.time()))
signature = hmac.new(b'whsec_fixture', timestamp.encode()+b'.'+payload, hashlib.sha256).hexdigest()
headers = {'Stripe-Signature':f't={timestamp},v1={signature}'}
check(request('/payments/webhook', 'POST', payload, headers, api=True)[0] == 201, 'Valid signed raw-body webhook accepted')
check(request('/payments/webhook', 'POST', payload+b' ', headers, api=True)[0] == 400, 'Altered webhook body rejected')
check(request('/payments/webhook','POST',payload,api=True)[0] == 400, 'Unsigned webhook rejected')
# Only fixture DB, through a project-gated local wrapper. No provider request or payment intent.
root = Path(__file__).resolve().parents[2]
subprocess.run(['sh',str(root/'scripts/staging/compose.sh'),'exec','-T','db','psql','-U','locker','-d','locker_staging','-v','ON_ERROR_STOP=1','-c', '''INSERT INTO "Locker" (id,code,location,"updatedAt") VALUES ('staging-fixture-locker','STAGING-FIXTURE','Simulation only',NOW()) ON CONFLICT DO NOTHING;'''],check=True,stdout=subprocess.DEVNULL)
proof = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('=')
key = str(uuid.uuid4())
owned = {'Authorization':'Bearer '+proof,'Idempotency-Key':key,'X-Forwarded-Proto':'http'}
now = dt.datetime.now(dt.timezone.utc)
body = {'lockerId':'staging-fixture-locker','startTime':(now+dt.timedelta(minutes=1)).isoformat(),'endTime':(now+dt.timedelta(hours=1)).isoformat()}
status, _, data = request('/api/public/reservations/hold','POST',body,owned)
check(status == 201, 'HTTPS ownership guard accepts only Caddy-derived scheme; status='+str(status)+' response='+data.decode() if status != 201 else 'HTTPS ownership guard accepts only Caddy-derived scheme')
reservation = json.loads(data)
retry = request('/api/public/reservations/hold','POST',body,owned)
check(retry[0] == 201 and json.loads(retry[2])['id'] == reservation['id'], 'Creation retry returns the same reservation')
status, _, recovered = request('/api/public/reservations/recovery',headers=owned)
recovered = json.loads(recovered)
check(status == 200 and recovered['id'] == reservation['id'] and recovered['expiresAt'] == reservation['expiresAt'], 'Lost-response recovery preserves reservation and deadline')
check(request('/api/public/reservations/'+reservation['id'], headers={'Authorization':'Bearer '+'B'*43})[0] == 404, 'Reservation ID alone/wrong ownership proof grants no access')
check(request('/api/public/payments/create-intent','POST',{'reservationId':reservation['id']})[0] == 401, 'Payment credentials require ownership proof')
print('Fixture HTTPS checks passed; no real Stripe API or device was contacted.')
