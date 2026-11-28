import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { dateLabel, firstStart, timeLabel, validSlot } from "../src/model";
import { useSession } from "../src/session";
import { Button, Chip, Copy, Heading, Page, s } from "../src/ui";
export default function Time() {
  const { slot, changeSlot } = useSession();
  const [start, setStart] = useState(() =>
    validSlot(slot) ? slot.start : firstStart(),
  );
  const [hours, setHours] = useState(slot.hours);
  const [error, setError] = useState("");
  const first = firstStart();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(first);
    d.setDate(d.getDate() + i);
    return d;
  });
  const times = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(start);
    d.setHours(i, 0, 0, 0);
    return d.getTime();
  }).filter((t, i, items) => t >= first && items.indexOf(t) === i);
  return (
    <Page back>
      <Heading>Choose your time</Heading>
      <Copy>Times are shown in your phone’s local time zone.</Copy>
      <Text style={s.heading}>Date</Text>
      <View style={s.wrap}>
        {dates.map((d) => (
          <Chip
            key={d.toDateString()}
            label={dateLabel(+d)}
            selected={d.toDateString() === new Date(start).toDateString()}
            onPress={() => {
              d.setHours(new Date(start).getHours(), 0, 0, 0);
              setStart(Math.max(first, +d));
            }}
          />
        ))}
      </View>
      <Text style={s.heading}>Start time</Text>
      <View style={s.wrap}>
        {times.map((t) => (
          <Chip
            key={t}
            label={timeLabel(t)}
            selected={t === start}
            onPress={() => setStart(t)}
          />
        ))}
      </View>
      <Text style={s.heading}>Duration</Text>
      <View style={s.wrap}>
        {[1, 2, 4].map((n) => (
          <Chip
            key={n}
            label={n + " " + (n === 1 ? "hour" : "hours")}
            selected={hours === n}
            onPress={() => setHours(n)}
          />
        ))}
      </View>
      {!!error && <Copy>{error}</Copy>}
      <Button
        label="Show availability"
        onPress={() => {
          if (!validSlot({ start, hours })) {
            setError("Choose a future start time.");
            return;
          }
          changeSlot({ start, hours });
          router.replace("/discover");
        }}
      />
    </Page>
  );
}
