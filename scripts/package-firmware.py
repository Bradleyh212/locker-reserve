#!/usr/bin/env python3
"""Package the committed production sketch as an unprovisioned application image."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FQBN = "esp32:esp32:esp32"
CORE = "3.3.12"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="vMAJOR.MINOR.PATCH")
    parser.add_argument("output", type=Path, help="New directory for release artifacts")
    parser.add_argument("--cli", default="arduino-cli")
    parser.add_argument("--config-file")
    args = parser.parse_args()
    if not re.fullmatch(r"v(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)){2}", args.version):
        parser.error("version must be vMAJOR.MINOR.PATCH")
    cli = [args.cli]
    if args.config_file:
        cli += ["--config-file", args.config_file]
    cores = json.loads(subprocess.check_output(cli + ["core", "list", "--format", "json"]))
    if not any(p["id"] == "esp32:esp32" and p["installed_version"] == CORE
               for p in cores["platforms"]):
        parser.error(f"install esp32:esp32@{CORE}")
    sha = git("rev-parse", "HEAD").decode().strip()
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        paths = git("ls-tree", "-r", "--name-only", sha, "firmware/src", "firmware/include")
        for name in paths.decode().splitlines():
            path = Path(name)
            if path.name == "config.local.h" or path.suffix not in (".h", ".cpp", ".ino"):
                continue
            dest = root / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(git("show", f"{sha}:{name}"))
        include = root / "firmware/include"
        config = (include / "config.example.h").read_text()
        (include / "config.local.h").write_text(
            config + f'\n#define LOCKER_FIRMWARE_VERSION "{args.version}"\n')
        build = root / "build"
        subprocess.run(cli + ["compile", "--fqbn", FQBN, "--output-dir", str(build),
                              str(root / "firmware/src")], check=True)
        source = build / "src.ino.bin"
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        filename = f"locker-esp32-{args.version}-{sha}.bin"
        metadata = dict(schema="locker-build-inventory/1", version=args.version,
                        commit=sha, board=FQBN, esp32_core=CORE, kind="application",
                        configuration="public-example", file=filename,
                        bytes=source.stat().st_size, sha256=digest)
        args.output.mkdir(parents=True, exist_ok=False)
        shutil.copyfile(source, args.output / filename)
        (args.output / "SHA256SUMS").write_text(f"{digest}  {filename}\n")
        (args.output / "manifest.json").write_text(json.dumps(metadata, indent=2) + "\n")


if __name__ == "__main__":
    main()
