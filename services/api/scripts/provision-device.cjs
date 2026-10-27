// Local operator provisioning. Token is written to a private file, never printed.
const { randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');

async function provisionDevice(db, deviceId, lockerId, tokenFile, io = fs) {
  const token = randomBytes(32).toString('hex');
  // Exclusive creation: never replace or remove an existing credential file.
  let fd = io.openSync(tokenFile, 'wx', 0o600);
  try {
    io.writeFileSync(fd, token + '\n');
    io.fsyncSync(fd);
    io.closeSync(fd);
    fd = undefined;
  } catch (error) {
    if (fd !== undefined) { try { io.closeSync(fd); } catch {} }
    try { io.unlinkSync(tokenFile); } catch {}
    throw error;
  }
  try {
    await db.lockerDevice.create({ data: {
      id: deviceId, lockerId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
    } });
  } catch (error) {
    // A connection failure can leave commit status unknown. Only remove the
    // credential when Prisma confirms this create was rejected.
    if (['P2002', 'P2003', 'P2025'].includes(error.code)) {
      try { io.unlinkSync(tokenFile); } catch {}
    }
    throw error;
  }
}

function safeError(error) {
  const messages = {
    EEXIST: 'Credential file already exists; choose a new path.',
    EACCES: 'Permission denied writing the credential file.',
    ENOENT: 'Credential directory does not exist.',
    ENOSPC: 'Not enough space to save the credential file.',
    P2002: 'Device ID or locker assignment already exists.',
    P2003: 'Referenced locker does not exist.',
    P2025: 'Referenced database record was not found.',
  };
  return messages[error.code] ||
    'Provisioning failed. A saved credential may remain; inspect the device record before retrying. Do not delete it until commit status is known.';
}

async function main() {
  require('dotenv/config');
  const { PrismaClient } = require('@prisma/client');
  const [deviceId, lockerId, tokenFile] = process.argv.slice(2);
  if (!deviceId || !lockerId || !tokenFile || !/^[a-zA-Z0-9_-]{1,64}$/.test(deviceId)) {
    console.error('Usage: node scripts/provision-device.cjs DEVICE_ID LOCKER_ID PRIVATE_TOKEN_FILE');
    process.exitCode = 1;
    return;
  }
  const db = new PrismaClient();
  try {
    await provisionDevice(db, deviceId, lockerId, tokenFile);
    console.log('Device provisioned. Credential saved to the supplied private file.');
  } catch (error) {
    console.error(safeError(error));
    process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
if (require.main === module) main().catch(() => { console.error('Provisioning cleanup failed.'); process.exitCode = 1; });
module.exports = { provisionDevice, safeError };
