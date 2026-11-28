import { Text, View } from "react-native";
import { LockKeyhole } from "lucide-react-native";
import { dateLabel, hour, timeLabel, type Locker, type Slot } from "./model";
import { c, Copy, s } from "./ui";
export function Ticket({ locker, slot }: { locker: Locker; slot: Slot }) {
  return (
    <View style={s.card}>
      <View style={s.row}>
        <View
          style={{ backgroundColor: c.rose, padding: 13, borderRadius: 13 }}
        >
          <LockKeyhole color={c.red} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.heading}>{locker.code}</Text>
          <Copy>{locker.location}</Copy>
        </View>
      </View>
      <View style={s.divider} />
      <Text style={s.strong}>{dateLabel(slot.start)}</Text>
      <Copy>
        {timeLabel(slot.start)} – {timeLabel(slot.start + slot.hours * hour)} ·{" "}
        {slot.hours} {slot.hours === 1 ? "hour" : "hours"}
      </Copy>
    </View>
  );
}
