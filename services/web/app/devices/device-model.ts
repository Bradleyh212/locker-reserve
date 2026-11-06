export const statusLabels: Record<string, string> = {
  OUTPUT_PULSE_COMPLETED: "Pulse completed",
  EXPIRED_UNKNOWN: "Expired · outcome unknown",
  REJECTED: "Rejected",
  QUEUED: "Queued",
  PENDING: "Command pending",
  FAILED: "Command failed",
  UNKNOWN: "Physical outcome unknown",
  DELIVERED: "Delivered",
};

export function readable(value: string) {
  return (
    value.charAt(0).toUpperCase() +
    value.slice(1).toLowerCase().replaceAll("_", " ")
  );
}

export type Device = {
  id: string;
  online: boolean;
  lastSeen: string | null;
  doorState: string;
  outputState: string;
  actuationEnabled: boolean;
  maxPulseMs: number;
  locker: { code: string };
  unlock: {
    allowed: boolean;
    blockedReason: string | null;
    maxPulseMs: number;
    cooldownUntil: string | null;
  };
  commands: {
    id: string;
    status: string;
    issuedAt: string;
    pulseMs: number;
    reason: string;
    resultReason: string | null;
    completedAt: string | null;
  }[];
};

export const statusLabel = (status: string) =>
  statusLabels[status] ?? readable(status);
