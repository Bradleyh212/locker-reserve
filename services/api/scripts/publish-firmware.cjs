// Publish one device-bound ESP32 application image without printing credentials.
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const [deviceId, imagePath] = process.argv.slice(2);
if (!deviceId || !imagePath) {
  console.error('Usage: node scripts/publish-firmware.cjs DEVICE_ID /path/to/src.ino.bin');
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '../../..');
const versionHeader = path.join(repoRoot, 'firmware/include/version.h');
const configuredDirectory = process.env.FIRMWARE_RELEASE_DIR;
const releaseDirectory = configuredDirectory
  ? path.resolve(configuredDirectory)
  : path.join(repoRoot, '.device-local/firmware');
const maxBytes = Number(process.env.OTA_MAX_IMAGE_BYTES ?? 1310720);
const inputName = path.basename(imagePath);

if (/merged|bootloader|partitions/i.test(inputName)) {
  console.warn(`Warning: '${inputName}' looks like a merged, bootloader or partition image.`);
}
if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
  console.error('OTA_MAX_IMAGE_BYTES must be a positive integer.');
  process.exit(1);
}

let versionText;
try {
  versionText = fs.readFileSync(versionHeader, 'utf8');
} catch {
  console.error('Cannot read firmware/include/version.h.');
  process.exit(1);
}
const versionMatch = versionText.match(/^\s*#define\s+FIRMWARE_VERSION\s+"([^"\r\n]+)"\s*$/m);
const buildMatch = versionText.match(/^\s*#define\s+FIRMWARE_BUILD\s+(\d+)\s*$/m);
if (!versionMatch || !buildMatch) {
  console.error('version.h must define FIRMWARE_VERSION and FIRMWARE_BUILD.');
  process.exit(1);
}
const version = versionMatch[1];
const buildNumber = Number(buildMatch[1]);

let image;
try {
  image = fs.readFileSync(imagePath);
} catch {
  console.error('Cannot read the firmware image.');
  process.exit(1);
}
if (image.length === 0 || image.length > maxBytes) {
  console.error(`Firmware image must be between 1 and ${maxBytes} bytes.`);
  process.exit(1);
}
if (image[0] !== 0xe9) {
  console.error('Input does not start with an ESP32 application image (0xE9).');
  process.exit(1);
}

const sha256 = createHash('sha256').update(image).digest('hex');
const safePart = (value) => String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
const fileName = `${safePart(deviceId)}-${safePart(version)}-${buildNumber}-${sha256.slice(0, 16)}.ino.bin`;
const outputPath = path.join(releaseDirectory, fileName);
const db = new PrismaClient();

(async () => {
  fs.mkdirSync(releaseDirectory, { recursive: true, mode: 0o700 });
  const device = await db.lockerDevice.findUnique({ where: { id: deviceId }, select: { id: true } });
  if (!device) throw new Error('Device not found.');
  const duplicate = await db.firmwareRelease.findFirst({
    where: { deviceId, OR: [{ version }, { buildNumber }] },
    select: { id: true },
  });
  if (duplicate) throw new Error('This device already has that firmware version or build number.');

  let fd;
  let created = false;
  try {
    fd = fs.openSync(outputPath, 'wx', 0o600);
    created = true;
    fs.writeFileSync(fd, image);
    fs.closeSync(fd);
    fd = undefined;
    await db.firmwareRelease.create({
      data: { deviceId, version, buildNumber, sha256, sizeBytes: image.length, fileName },
    });
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    if (created) {
      try { fs.unlinkSync(outputPath); } catch {}
    }
    throw error;
  }
  console.log(`Firmware release published: ${version} build ${buildNumber}, ${image.length} bytes, SHA-256 ${sha256}.`);
})()
  .catch((error) => {
    console.error(`Firmware publish failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
