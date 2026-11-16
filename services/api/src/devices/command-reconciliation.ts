import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const unresolvedCommand: Prisma.DeviceCommandWhereInput = {
  reconciliation: { is: null },
  OR: [{ result: null }, { result: 'UNKNOWN' }],
};

export function reconciliationInput(
  body: unknown,
  actor?: { sub?: string; role?: string },
) {
  if (
    actor?.role !== 'admin' ||
    typeof actor.sub !== 'string' ||
    !actor.sub.trim()
  )
    throw new ForbiddenException('An identified administrator is required');
  const b = body as Record<string, unknown>;
  if (
    !b ||
    typeof b !== 'object' ||
    Array.isArray(b) ||
    Object.keys(b).some(
      (k) => !['reason', 'evidence', 'physicalSafetyConfirmed'].includes(k),
    ) ||
    b.physicalSafetyConfirmed !== true ||
    typeof b.reason !== 'string' ||
    b.reason.trim().length < 10 ||
    b.reason.length > 500 ||
    typeof b.evidence !== 'string' ||
    b.evidence.trim().length < 10 ||
    b.evidence.length > 2000
  )
    throw new BadRequestException(
      'Confirm physical safety review and provide a reason (10–500 characters) and evidence (10–2000 characters)',
    );
  return {
    operatorId: actor.sub,
    reason: b.reason.trim(),
    evidence: b.evidence.trim(),
    physicalSafetyConfirmed: true,
  };
}
