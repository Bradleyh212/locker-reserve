import {
  DoorClosed,
  DoorOpen,
  LockKeyhole,
  LockKeyholeOpen,
  Wifi,
  WifiOff,
  CircleHelp,
  type LucideIcon,
} from "lucide-react";
import type { Device } from "./device-model";
import styles from "./devices.module.css";

type Reading = [
  string,
  string,
  LucideIcon,
  "good" | "danger" | "warning" | "neutral",
];
export function deviceReadings(
  device: Device,
  disconnected: boolean,
): Reading[] {
  const stale = disconnected || !device.online;
  return [
    disconnected
      ? ["Connection", "Unknown", CircleHelp, "neutral"]
      : device.online
        ? ["Connection", "Online", Wifi, "good"]
        : ["Connection", "Offline", WifiOff, "danger"],
    stale || !["OPEN", "CLOSED"].includes(device.doorState)
      ? ["Door", "Unknown", DoorClosed, "neutral"]
      : device.doorState === "OPEN"
        ? ["Door", "Open", DoorOpen, "danger"]
        : ["Door", "Closed", DoorClosed, "good"],
    stale || !["ACTIVE", "INACTIVE"].includes(device.outputState)
      ? ["Driver", "Unknown", LockKeyhole, "neutral"]
      : device.outputState === "ACTIVE"
        ? ["Driver", "Energized", LockKeyholeOpen, "warning"]
        : ["Driver", "Inactive", LockKeyhole, "neutral"],
  ];
}

export default function DeviceStatus({
  device,
  disconnected,
  large = false,
}: {
  device: Device;
  disconnected: boolean;
  large?: boolean;
}) {
  const readings = deviceReadings(device, disconnected);
  return (
    <dl className={large ? styles.largeReadings : styles.readings}>
      {readings.map(([label, value, Icon, tone]) => (
        <div
          key={label}
          className={styles.reading}
          title={
            label === "Driver" ? "Reported solenoid driver output" : undefined
          }
        >
          <dt>
            <Icon aria-hidden="true" className={styles[tone]} />
            <span>{label}</span>
          </dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
