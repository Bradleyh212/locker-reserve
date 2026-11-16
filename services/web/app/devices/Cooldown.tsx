import { useEffect, useRef, useState } from "react";
export type ClockSample = { server: number; received: number };

function remaining(until: number, clock: ClockSample | null) {
  const now = clock
    ? clock.server + performance.now() - clock.received
    : Date.now();
  return Math.max(0, Math.ceil((until - now) / 1000));
}
function duration(seconds: number) {
  if (seconds < 60) return seconds + "s";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "m " + (seconds % 60) + "s";
  return Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
}
export default function Cooldown({
  until,
  clock,
  revalidate,
}: {
  until: string;
  clock: ClockSample | null;
  revalidate: () => void;
}) {
  const deadline = Date.parse(until);
  const [seconds, setSeconds] = useState(() => remaining(deadline, clock));
  const checked = useRef(false);
  useEffect(() => {
    if (!Number.isFinite(deadline)) return;
    let timer: ReturnType<typeof setTimeout>;
    function tick() {
      const left = remaining(deadline, clock);
      setSeconds(left);
      if (left > 0) timer = setTimeout(tick, 1000);
      else if (!checked.current) {
        checked.current = true;
        revalidate();
      }
    }
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [clock, deadline, revalidate]);
  if (!Number.isFinite(deadline)) return null;
  return (
    <span role="timer" aria-live="off">
      {seconds > 0
        ? " Retry in " + duration(seconds)
        : " Checking availability…"}
    </span>
  );
}
