import { createHash, randomBytes } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';

export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const issueToken = () => randomBytes(32).toString('base64url');

export function bearerHash(header?: string) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? '');
  if (!match)
    throw new UnauthorizedException('Reservation credential required');
  return digest(match[1]);
}

export function eligible(
  reservation: {
    status: string;
    startTime: Date;
    endTime: Date;
    access: {
      paymentIntentId: string | null;
      paidAt: Date | null;
      revokedAt: Date | null;
    } | null;
  },
  now: number,
) {
  return (
    reservation.status === 'CONFIRMED' &&
    !!reservation.access?.paymentIntentId &&
    !!reservation.access.paidAt &&
    !reservation.access.revokedAt &&
    reservation.startTime.getTime() <= now &&
    now < reservation.endTime.getTime()
  );
}

export function customerStatus(command: {
  id: string;
  expiresAt: Date;
  result: string | null;
}) {
  const unknown =
    command.result === 'UNKNOWN' ||
    (!command.result && command.expiresAt.getTime() <= Date.now());
  return {
    commandId: command.id,
    expiresAt: command.expiresAt,
    status: unknown ? 'OUTCOME_UNKNOWN' : (command.result ?? 'PENDING'),
  };
}
