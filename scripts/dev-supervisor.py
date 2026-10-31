#!/usr/bin/env python3
"""Own only this checkout's dev process groups; never erase persistent data."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import socket
import ssl
import subprocess as sp
import sys
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / '.local-dev'
COMPOSE = ['docker', 'compose', '-f', str(ROOT / 'infra/local/docker-compose.yml')]
CHILDREN = []
RUN_ID = ''
STOPPING = False


def say(message):
    print(message, flush=True)


def command(args, cwd=ROOT, timeout=120, env=None):
    return sp.check_output(args, cwd=cwd, env=env, timeout=timeout, stderr=sp.STDOUT, text=True).strip()


def identity(pid):
    try:
        return command(['ps', '-p', str(pid), '-o', 'lstart='], timeout=5)
    except (sp.SubprocessError, OSError):
        return ''


def read_env(path):
    if not path.exists():
        raise RuntimeError(f'Missing {path.relative_to(ROOT)}; copy its .env.example and fill local credentials.')
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'): continue
        if line.startswith('export '): line = line[7:]
        key, sep, value = line.partition('=')
        if not sep: continue
        value = value.strip()
        if value.startswith(('"', "'")):
            if len(value) < 2 or value[-1] != value[0]:
                raise RuntimeError(f'Unsupported multiline/quoted value in {path.name}: {key}')
            quote = value[0]
            value = value[1:-1]
            if quote == '"': value = value.replace('\\n', '\n').replace('\\r', '\r')
        else: value = value.split('#', 1)[0].rstrip()
        values[key.strip()] = value
    return values


def config():
    api = read_env(ROOT / 'services/api/.env')
    web = read_env(ROOT / 'services/web/.env.local')
    # Explicit files own app settings, rather than stale terminal exports.
    from urllib.parse import urlparse
    db = urlparse(api.get('DATABASE_URL', ''))
    redis = urlparse(api.get('REDIS_URL', 'redis://localhost:6379'))
    if db.hostname not in ('localhost', '127.0.0.1') or db.port != 5433 or db.path != '/locker':
        raise RuntimeError('Local startup only migrates localhost:5433/locker; check DATABASE_URL. No database changed.')
    if redis.hostname not in ('localhost', '127.0.0.1') or (redis.port or 6379) != 6379:
        raise RuntimeError('Local startup requires Redis on localhost:6379.')
    if api.get('PORT', '3001') != '3001': raise RuntimeError('Local API PORT must be 3001.')
    if web.get('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3001').rstrip('/') != 'http://localhost:3001':
        raise RuntimeError('NEXT_PUBLIC_API_BASE_URL must be http://localhost:3001 for this local workflow.')
    if api.get('CORS_ORIGIN', 'http://localhost:3000') != 'http://localhost:3000':
        raise RuntimeError('Local CORS_ORIGIN must be http://localhost:3000.')
    for name in ('JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH'):
        if not api.get(name): raise RuntimeError(f'Fill {name} in services/api/.env (not printed).')
    limit = int(api.get('DEVICE_MAX_PULSE_MS', '0'))
    if not 0 <= limit <= 5000: raise RuntimeError('DEVICE_MAX_PULSE_MS must be 0..5000.')
    if bool(api.get('DEVICE_TLS_KEY')) != bool(api.get('DEVICE_TLS_CERT')):
        raise RuntimeError('Set both DEVICE_TLS_KEY and DEVICE_TLS_CERT, or neither.')
    if api.get('DEVICE_TLS_KEY'):
        if api.get('DEVICE_TLS_PORT', '3443') != '3443': raise RuntimeError('Local DEVICE_TLS_PORT must be 3443.')
        for key in ('DEVICE_TLS_KEY', 'DEVICE_TLS_CERT'):
            p = Path(api[key]); p = p if p.is_absolute() else ROOT / 'services/api' / p
            if not p.is_file(): raise RuntimeError(f'{key} file is missing.')
    api.setdefault('REDIS_URL', 'redis://localhost:6379')
    api.setdefault('CORS_ORIGIN', 'http://localhost:3000')
    api['PORT'] = '3001'
    web['NEXT_PUBLIC_API_BASE_URL'] = 'http://localhost:3001'
    return api, web


def listener(port):
    try: return command(['lsof', '-nP', f'-iTCP:{port}', '-sTCP:LISTEN'], timeout=5)
    except sp.CalledProcessError: return ''


def require_free(ports):
    for port in ports:
        info = listener(port)
        if info: raise RuntimeError(f'Port {port} is already owned:\n{info}\nUse dev-stop.sh for managed processes; stop other instances in their original terminal. No arbitrary PID was killed.')


def legacy_containers(clean=False):
    found = []
    for name in ('locker_web', 'locker_api'):
        try: item = json.loads(command(['docker', 'inspect', name]))[0]
        except sp.CalledProcessError: continue
        labels = item.get('Config', {}).get('Labels') or {}
        workdir = labels.get('com.docker.compose.project.working_dir', '')
        files = labels.get('com.docker.compose.project.config_files', '')
        owned = (workdir and Path(workdir).resolve() == (ROOT / 'infra/local').resolve()) or str(ROOT / 'infra/local/') in files
        if not clean:
            found.append(name + ' (' + item['State']['Status'] + ')')
        elif not owned:
            raise RuntimeError(f'{name} exists but its Compose labels do not identify this checkout. Inspect it manually; it was not removed.')
        else:
            say(f'Removing obsolete {name} application container (no volumes removed).')
            command(['docker', 'update', '--restart=no', name])
            command(['docker', 'stop', '--time', '10', name])
            command(['docker', 'rm', name])
    return found


def healthy(url, run_id=None, context=None):
    try:
        with urllib.request.urlopen(url, timeout=3, context=context) as response:
            if response.status != 200: return False
            if run_id is not None:
                data = json.load(response)
                return data.get('service') == 'locker-reserve-api' and data.get('runId') == run_id and data.get('status') == 'ok'
            return True
    except Exception: return False


def state_write(phase):
    data = dict(root=str(ROOT), supervisor=os.getpid(), identity=identity(os.getpid()), runId=RUN_ID,
                phase=phase, children=[dict(pid=c.pid, identity=tag, name=name) for name,c,tag in CHILDREN])
    temp = STATE / 'state.tmp'
    temp.write_text(json.dumps(data)); temp.replace(STATE / 'state.json')


def spawn(name, args, cwd, env):
    log = STATE / f'{name}.log'
    with log.open('a') as output:
        output.write(f'\n--- {time.ctime()} {name}: {shlex.join(args)} ---\n'); output.flush()
        child = sp.Popen(args, cwd=cwd, env=env, stdout=output, stderr=sp.STDOUT,
                         stdin=sp.DEVNULL, start_new_session=True)
    CHILDREN.append((name, child, identity(child.pid)))
    state_write(name)
    say(f'{name}: PID {child.pid}; log {log}')
    return child


def run_step(name, args, cwd, env, timeout=300):
    child = spawn(name, args, cwd, env)
    try:
        code = child.wait(timeout=timeout)
        if code: raise RuntimeError(f'{name} failed ({code}); see {STATE / (name + ".log")}')
    except sp.TimeoutExpired:
        raise RuntimeError(f'{name} timed out; see {STATE / (name + ".log")}')
    # Reap completed preparation children, but retain their logs.
    CHILDREN[:] = [entry for entry in CHILDREN if entry[1] is not child]
    state_write('preparing')


def fingerprint(paths):
    h = hashlib.sha256()
    for p in paths: h.update(p.read_bytes())
    h.update(command(['node', '-p', 'process.versions.node + process.platform + process.arch']).encode())
    return h.hexdigest()


def install_needed(folder):
    lock = folder / 'package-lock.json'; hidden = folder / 'node_modules/.package-lock.json'
    if not hidden.exists(): return True
    try:
        expected = json.loads(lock.read_text())['packages']; actual = json.loads(hidden.read_text())['packages']
        for name, package in expected.items():
            if not name: continue
            installed = actual.get(name)
            if not installed:
                if package.get('optional'): continue
                return True
            if package.get('version') != installed.get('version') or package.get('integrity') != installed.get('integrity'): return True
            if not (folder / name / 'package.json').exists(): return True
        command(['npm', 'ls', '--depth=0', '--offline'], cwd=folder, timeout=30)
        return False
    except (KeyError, ValueError, OSError, sp.SubprocessError): return True


def prepare(name, env):
    folder = ROOT / 'services' / name
    stamp = STATE / f'{name}-deps.sha256'
    digest = fingerprint([folder/'package.json', folder/'package-lock.json'])
    binaries = ['nest', 'prisma'] if name == 'api' else ['next']
    missing = any(not (folder/'node_modules/.bin'/b).exists() for b in binaries)
    if missing or not stamp.exists() or stamp.read_text() != digest:
        if missing or install_needed(folder):
            run_step(f'{name}-install', ['npm', 'ci', '--no-audit', '--no-fund'], folder, env)
        else: say(f'{name}: existing dependencies match the lockfile; no install.')
        stamp.write_text(digest)
    else: say(f'{name}: dependency fingerprint unchanged; no install.')


def group_alive(pid):
    try: os.killpg(pid, 0); return True
    except ProcessLookupError: return False


def terminate_groups(entries):
    # A live leader with a different creation time is a reused PID, not ours.
    eligible=[]
    for pid, tag in entries:
        current=identity(pid)
        if current and current != tag: continue
        if group_alive(pid):
            eligible.append((pid,tag))
            try: os.killpg(pid,signal.SIGTERM)
            except ProcessLookupError: pass
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        for _, child, _ in CHILDREN: child.poll()  # Reap leaders while checking descendants.
        if not any(group_alive(pid) for pid,_ in eligible): break
        time.sleep(.1)
    for pid,tag in eligible:
        current=identity(pid)
        if current and current != tag: continue
        if group_alive(pid):
            try: os.killpg(pid,signal.SIGKILL)
            except ProcessLookupError: pass


def cleanup():
    terminate_groups([(child.pid,tag) for _,child,tag in reversed(CHILDREN)])
    for _, child, _ in CHILDREN:
        try: child.wait(timeout=1)
        except sp.TimeoutExpired: pass
    state_write('stopped')


def interrupted(signum, frame):
    global STOPPING
    if not STOPPING:
        STOPPING = True
        raise KeyboardInterrupt


def wait_health(url, child, timeout, run_id=None, context=None):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if child.poll() is not None: raise RuntimeError(f'Server exited ({child.returncode}); inspect logs in {STATE}.')
        if healthy(url, run_id, context): return
        time.sleep(1)
    raise RuntimeError(f'Readiness timed out for {url}; inspect {STATE}. Startup is NOT successful.')


def start():
    global RUN_ID
    for tool in ('node','npm','docker','lsof','ps'):
        if not shutil.which(tool): raise RuntimeError(f'Missing prerequisite: {tool}')
    STATE.mkdir(exist_ok=True); os.chmod(STATE,0o700)
    with (STATE/'supervisor.lock').open('w') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError('This checkout is already starting/running. Use dev-status.sh or dev-stop.sh.')
        api, web = config()
        command(['docker','info'],timeout=15)
        command(COMPOSE+['version'],timeout=10)
        legacy_containers(clean=True)
        require_free([3000,3001,3443])
        RUN_ID = str(uuid.uuid4())
        for sig in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP): signal.signal(sig,interrupted)
        base = {**os.environ, 'NODE_DISABLE_COMPILE_CACHE':'1', 'NEXT_TELEMETRY_DISABLED':'1'}
        api_env = {**base, **api, 'LOCAL_DEV_RUN_ID':RUN_ID}
        web_env = {**base, **web}
        say('Docker owns PostgreSQL:5433 and Redis:6379. This terminal owns API:3001/3443 and web:3000.')
        try:
            state_write('preparing')
            run_step('docker',COMPOSE+['up','-d','--wait','--wait-timeout','90'],ROOT,base,120)
            prepare('api',api_env); prepare('web',web_env)
            api_dir=ROOT/'services/api'
            schema=api_dir/'prisma/schema.prisma'
            digest=fingerprint([schema,api_dir/'package-lock.json'])
            generated=api_dir/'node_modules/.prisma/client/index.d.ts'
            stamp=STATE/'prisma.sha256'
            if not stamp.exists() or stamp.read_text()!=digest or not generated.exists() or not (generated.parent/'index.js').exists() or 'LockerDevice' not in generated.read_text():
                run_step('prisma-generate',['npx','--no-install','prisma','generate'],api_dir,api_env)
                stamp.write_text(digest)
            else: say('Prisma client matches schema/lockfile.')
            run_step('migrations',['npx','--no-install','prisma','migrate','deploy'],api_dir,api_env)
            api_process=spawn('api',['npm','run','start:dev'],api_dir,api_env)
            wait_health('http://localhost:3001/health',api_process,180,RUN_ID)
            if api.get('DEVICE_TLS_CERT'):
                cert=Path(api['DEVICE_TLS_CERT']); cert=cert if cert.is_absolute() else api_dir/cert
                # Validate certificate with its SAN IP/DNS, without disabling TLS checks.
                info=ssl._ssl._test_decode_cert(str(cert))
                names=[value for kind,value in info.get('subjectAltName',[]) if kind in ('DNS','IP Address')]
                host='localhost' if 'localhost' in names else names[0] if names else None
                if not host: raise RuntimeError('Device TLS certificate needs a SAN hostname/IP.')
                wait_health(f'https://{host}:3443/health',api_process,15,RUN_ID,ssl.create_default_context(cafile=str(cert)))
            web_process=spawn('web',['npm','run','dev','--','--port','3000'],ROOT/'services/web',web_env)
            wait_health('http://localhost:3000/login',web_process,180)
            state_write('ready')
            say(f'READY: http://localhost:3000/devices | API http://localhost:3001/health\nSupervisor PID {os.getpid()}; API PID {api_process.pid}; web PID {web_process.pid}\nLogs: {STATE}\nCtrl+C stops API/web; PostgreSQL data is preserved.')
            while True:
                for name, child, _ in CHILDREN:
                    if child.poll() is not None: raise RuntimeError(f'{name} exited unexpectedly; stopping the paired dev process.')
                time.sleep(1)
        except KeyboardInterrupt: say('Stopping local API/web...')
        finally: cleanup()


def load_state():
    try: return json.loads((STATE/'state.json').read_text())
    except (OSError,ValueError): return {}


def owned_supervisor(data):
    if not (data.get('root')==str(ROOT) and data.get('identity') and identity(data.get('supervisor',0))==data['identity']): return False
    try:
        argv=command(['ps','-p',str(data['supervisor']),'-o','command='],timeout=5)
        return str(ROOT/'scripts/dev-supervisor.py') in argv
    except (sp.SubprocessError,OSError): return False


def stop():
    data=load_state()
    if not owned_supervisor(data):
        # Recover children of a crashed supervisor only if their leader identity
        # still matches the recorded process. Never infer ownership from a port.
        matches=[]
        if data.get('root')==str(ROOT):
            for child in data.get('children',[]):
                if child.get('identity') and identity(child['pid'])==child['identity']:
                    if os.getpgid(child['pid'])==child['pid']: matches.append((child['pid'],child['identity']))
        if matches:
            terminate_groups(matches)
            say('Recovered tracked children of an exited supervisor; data preserved.')
        else:
            say('No live supervisor owned by this checkout. Unmanaged listeners are not killed; run dev-status.sh.')
        return
    os.kill(data['supervisor'],signal.SIGTERM)
    deadline=time.monotonic()+20
    while time.monotonic()<deadline and owned_supervisor(data): time.sleep(.2)
    if owned_supervisor(data): raise RuntimeError('Supervisor did not stop; inspect logs before manual intervention.')
    say('Managed API/web stopped. DB and Redis left running; data preserved.')


def status():
    data=load_state(); live=owned_supervisor(data)
    say(f'Supervisor: {data.get("supervisor","none")} ({data.get("phase","not started")}); owned/live={live}')
    docker_ok=True
    try:
        say(command(COMPOSE+['ps'],timeout=15))
        for name in ('locker_db','locker_redis'):
            health=command(['docker','inspect','--format','{{.State.Health.Status}}',name],timeout=5)
            say(f'{name} health: {health}')
            docker_ok=docker_ok and health=='healthy'
        for name in legacy_containers(): say('OBSOLETE CONTAINER: '+name); docker_ok=False
    except (sp.SubprocessError,OSError): say('Docker/Compose unavailable.'); docker_ok=False
    for port in (5433,6379,3001,3443,3000): say(f'Port {port}:\n{listener(port) or "not listening"}')
    api_ok=healthy('http://localhost:3001/health',data.get('runId',''))
    web_ok=healthy('http://localhost:3000/login')
    tls_ok=True
    try:
        api,_=config()
        if api.get('DEVICE_TLS_CERT'):
            cert=Path(api['DEVICE_TLS_CERT']); cert=cert if cert.is_absolute() else ROOT/'services/api'/cert
            names=[v for k,v in ssl._ssl._test_decode_cert(str(cert)).get('subjectAltName',[]) if k in ('DNS','IP Address')]
            host='localhost' if 'localhost' in names else names[0]
            tls_ok=healthy(f'https://{host}:3443/health',data.get('runId',''),ssl.create_default_context(cafile=str(cert)))
            say('Device HTTPS readiness: '+('PASS' if tls_ok else 'FAIL'))
        else: say('Device HTTPS: not configured')
    except Exception: tls_ok=False; say('Device HTTPS/config: FAIL')
    say('API readiness: '+('PASS' if api_ok else 'FAIL'))
    say('Web login: '+('PASS' if web_ok else 'FAIL'))
    say(f'Logs: {STATE}')
    return 0 if live and docker_ok and api_ok and web_ok and tls_ok else 1


def main():
    action=sys.argv[1] if len(sys.argv)>1 else 'start'
    try:
        if action=='start': start()
        elif action=='stop': stop()
        elif action=='status': return status()
        elif action=='reset':
            stop()
            for name in ('api-deps.sha256','web-deps.sha256','prisma.sha256'):
                (STATE/name).unlink(missing_ok=True)
            start()
        else: raise RuntimeError('Expected start, stop, status, or reset.')
    except (RuntimeError,sp.SubprocessError,OSError,ValueError) as exc:
        # CalledProcessError output is intentionally not dumped (may contain config).
        say('ERROR: '+str(exc)); return 1
    return 0

if __name__=='__main__': sys.exit(main())
