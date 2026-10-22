// Local operator provisioning. Token is written to a private file, never printed.
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { randomBytes, createHash } = require('crypto');
const fs = require('fs');
const [deviceId, lockerId, tokenFile] = process.argv.slice(2);
if (!deviceId || !lockerId || !tokenFile || !/^[a-zA-Z0-9_-]{1,64}$/.test(deviceId)) {
  console.error('Usage: node scripts/provision-device.cjs DEVICE_ID LOCKER_ID PRIVATE_TOKEN_FILE'); process.exit(1);
}
const db = new PrismaClient();
(async () => {
  const token = randomBytes(32).toString('hex');
  const fd = fs.openSync(tokenFile, 'wx', 0o600);
  try {
    await db.lockerDevice.create({ data: { id: deviceId, lockerId, tokenHash: createHash('sha256').update(token).digest('hex') } });
    fs.writeFileSync(fd, token + '\n');
    console.log('Device provisioned. Credential saved to the supplied private file.');
  } catch (e) { fs.unlinkSync(tokenFile); throw e; }
  finally { fs.closeSync(fd); }
})().catch(() => { console.error('Provisioning failed; verify IDs, unique assignment and database availability.'); process.exitCode=1; }).finally(() => db.$disconnect());
