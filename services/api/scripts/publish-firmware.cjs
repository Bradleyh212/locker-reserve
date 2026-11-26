// Publish one device-bound ESP32 application image without printing credentials.
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

// Input must come from a reviewed CI run for main. A hash alone is not
// authorization; the trusted operator selects the artifact and target device.
const [deviceId, imagePath, expectedHash] = process.argv.slice(2);
const releaseDirectory = process.env.FIRMWARE_RELEASE_DIR;
if (!deviceId || !imagePath || !/^[a-f0-9]{64}$/.test(expectedHash || '') ||
    !releaseDirectory || !path.isAbsolute(releaseDirectory)) {
  console.error('Set FIRMWARE_RELEASE_DIR and provide DEVICE_ID APP_BIN EXPECTED_SHA256');
  process.exit(1);
}
const size = fs.statSync(imagePath).size;
if (size <= 288 || size > 1310720) throw new Error('Invalid OTA application size');
const image = fs.readFileSync(imagePath);
const sha256 = createHash('sha256').update(image).digest('hex');
if (sha256 !== expectedHash || image[0] !== 0xe9 || image.readUInt16LE(12) !== 0 ||
    image.readUInt32LE(32) !== 0xabcd5432) throw new Error('Digest or ESP32 application descriptor mismatch');
const match = /^ota-([1-9][0-9]*)-([0-9a-f]{12})\.bin$/.exec(path.basename(imagePath));
if (!match) throw new Error('Expected CI versioned application filename');
const version = path.basename(imagePath, '.bin');
const buildNumber = Number(match[1]);
if (!Number.isSafeInteger(buildNumber) || buildNumber > 2147483647 ||
    !image.includes(Buffer.from(`LR_OTA_APP:${version}:${buildNumber}:\0`)) ||
    image.includes(Buffer.from('LR_USB_PRIVATE'))) throw new Error('Expected matching credential-free CI application');
// One immutable blob may be referenced by several device-specific records.
const fileName = sha256 + '.bin';
const outputPath = path.join(releaseDirectory, fileName);
const db = new PrismaClient();

(async () => {
  fs.mkdirSync(releaseDirectory, { recursive: true, mode: 0o700 });
  const device = await db.lockerDevice.findUnique({ where: { id: deviceId }, select: { id: true } });
  if (!device) throw new Error('Device not found.');
  const temporary = fs.mkdtempSync(path.join(releaseDirectory, '.publish-'));
  const staged = path.join(temporary, 'image');
  try {
    fs.writeFileSync(staged, image, { mode: 0o600, flush: true, flag: 'wx' });
    try {
      fs.linkSync(staged, outputPath);
    } catch (err) {
      if (err.code !== 'EEXIST' || !fs.readFileSync(outputPath).equals(image)) throw err;
    }
    const parent = fs.openSync(releaseDirectory, 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    const release = await db.firmwareRelease.upsert({
      where: { deviceId_buildNumber: { deviceId, buildNumber } },
      create: { deviceId, version, buildNumber, sha256, sizeBytes: image.length, fileName },
      update: {},
    });
    if (release.sha256 !== sha256 || release.version !== version)
      throw new Error('Existing build differs');
  } finally {
    // Retain the durable blob across ambiguous database commit results.
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log(`Firmware release published: ${version} build ${buildNumber}, ${image.length} bytes, SHA-256 ${sha256}.`);
})()
  .catch((error) => {
    console.error('Firmware publish failed; verify target, uniqueness and storage permissions.');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
