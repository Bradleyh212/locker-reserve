// Operator-only CLI, not an HTTP endpoint. Never prints a credential or DB error.
const fs = require('node:fs');
const { randomBytes, createHash, randomUUID } = require('node:crypto');
const { provisionDevice, safeError } = require('./provision-device.cjs');

function writeToken(file) {
  const token = randomBytes(32).toString('hex');
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, token + '\n'); fs.fsyncSync(fd); }
  catch (error) { fs.closeSync(fd); fs.unlinkSync(file); throw error; }
  fs.closeSync(fd);
  return createHash('sha256').update(token).digest('hex');
}

function stagingOnly(env) {
  const url = new URL(env.DATABASE_URL);
  if (url.protocol !== 'postgresql:' || !env.STAGING_CONFIG_FILE || url.hostname !== 'db' || url.pathname !== '/locker_staging' ||
      env.DEVICE_MAX_PULSE_MS !== '0' || env.CUSTOMER_UNLOCK_PULSE_MS !== '0') {
    throw new Error('Refuse non-staging configuration');
  }
}

async function credentialOperation(db, { operation, deviceId, lockerId, tokenFile, actor, reason }) {
  if (!['create', 'rotate', 'revoke'].includes(operation) ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(deviceId || '') ||
      typeof actor !== 'string' || actor.trim().length < 3 || actor.length > 120 ||
      typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 400 ||
      (operation !== 'revoke' && !tokenFile) || (operation === 'create' && !lockerId)) {
    throw new Error('Invalid operation arguments');
  }
  // Never include tokens/hashes in audit details. Identity is the accountable SSH
  // operator supplied for this privileged offline procedure, not a browser JWT.
  const audit = { deviceId, type: 'CREDENTIAL_' + operation.toUpperCase(), severity: 'WARN',
    dedupeKey: 'credential:' + randomUUID(), details: { operatorId: actor.trim(), reason: reason.trim() } };
  if (operation === 'create') {
    // Provision saves an exclusive credential before a transaction can commit.
    // Ambiguous failure retains it; inspect identity/hash before any retry.
    return db.$transaction(async tx => {
      await provisionDevice(tx, deviceId, lockerId, tokenFile);
      await tx.deviceEvent.create({ data: audit });
    });
  }
  // Rotation also leaves the saved token on any DB error, including an unknown
  // commit. Do not lose the only copy by automatically cleaning it up.
  const tokenHash = operation === 'rotate' ? writeToken(tokenFile) : undefined;
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "LockerDevice" WHERE "id" = ${deviceId} FOR UPDATE`;
    const device = await tx.lockerDevice.findUnique({ where: { id: deviceId } });
    if (!device) throw new Error('Unknown device');
    await tx.lockerDevice.update({ where: { id: deviceId }, data: operation === 'revoke'
      ? { enabled: false } : { tokenHash } });
    await tx.deviceEvent.create({ data: audit });
  });
  // Rotation never re-enables a revoked device or changes mapping/capabilities,
  // command outcomes, health, acknowledgements or existing historical events.
}

async function main() {
  const [operation, deviceId, lockerId, tokenFile, actor, reason] = process.argv.slice(2);
  stagingOnly(process.env);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    await credentialOperation(db, { operation, deviceId, lockerId,
      tokenFile: tokenFile === '-' ? undefined : tokenFile, actor, reason });
    console.log('Credential operation recorded. No command was enqueued; no credential printed.');
  } finally { await db.$disconnect(); }
}
if (require.main === module) main().catch(error => {
  console.error(safeError(error)); process.exitCode = 1;
});
module.exports = { credentialOperation, stagingOnly };
