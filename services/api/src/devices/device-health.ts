import { BadRequestException } from '@nestjs/common';

// Never permit a configuration to relax the existing 15-second safety bound.
export function freshnessMs() {
  const value = Number(process.env.DEVICE_HEARTBEAT_FRESH_MS ?? 15000);
  if (!Number.isInteger(value) || value < 1000 || value > 15000)
    throw new Error('DEVICE_HEARTBEAT_FRESH_MS must be 1000..15000');
  return value;
}
export function isFresh(lastSeen: Date | null, now = Date.now()) {
  const age = lastSeen ? now - lastSeen.getTime() : -1;
  return age >= 0 && age < freshnessMs();
}
export type Diagnostics = {
  bootId: string;
  uptimeMs: number;
  resetReason: string;
  wifiDisconnects: number;
  communicationFailures: number;
};
const reasons = [
  'UNKNOWN',
  'POWERON',
  'EXT',
  'SW',
  'PANIC',
  'INT_WDT',
  'TASK_WDT',
  'WDT',
  'DEEPSLEEP',
  'BROWNOUT',
  'SDIO',
  'USB',
  'JTAG',
  'EFUSE',
  'PWR_GLITCH',
  'CPU_LOCKUP',
];
export function parseDiagnostics(value: unknown): Diagnostics | undefined {
  if (value === undefined) return undefined; // Existing firmware remains supported.
  const d = value as Diagnostics;
  if (
    !d ||
    typeof d.bootId !== 'string' ||
    !/^[a-f0-9]{32}$/.test(d.bootId) ||
    !Number.isSafeInteger(d.uptimeMs) ||
    d.uptimeMs < 0 ||
    !reasons.includes(d.resetReason) ||
    ![d.wifiDisconnects, d.communicationFailures].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 2147483647,
    )
  )
    throw new BadRequestException('Invalid diagnostics');
  // Explicit allowlist: never persist arbitrary device payloads.
  return {
    bootId: d.bootId,
    uptimeMs: d.uptimeMs,
    resetReason: d.resetReason,
    wifiDisconnects: d.wifiDisconnects,
    communicationFailures: d.communicationFailures,
  };
}
