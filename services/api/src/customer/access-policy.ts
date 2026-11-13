import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const issueToken = () => randomBytes(32).toString('base64url');

export function bearerHash(header?: string) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? '');
  if (!match)
    throw new UnauthorizedException('Reservation credential required');
  return digest(match[1]);
}

export function reservationAmount(r: { startTime: Date; endTime: Date }) {
  return Math.max(
    1,
    Math.round(((r.endTime.getTime() - r.startTime.getTime()) / 3600000) * 500),
  );
}
export function creationKey(value?: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value ?? '',
    )
  )
    throw new BadRequestException('Idempotency-Key must be a UUID v4');
  return value!.toLowerCase();
}
