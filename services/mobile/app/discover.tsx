import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  CalendarClock,
  ChevronRight,
  LockKeyhole,
  Search,
} from "lucide-react-native";
import {
  available,
  dateLabel,
  readAvailability,
  timeLabel,
  validSlot,
  type Locker,
} from "../src/model";
import { useSession } from "../src/session";
import { Campus } from "../src/campus";
import { Button, c, Chip, Copy, Heading, Page, s } from "../src/ui";
export default function Discover() {
  const {
    mode,
    slot,
    bookings,
    select,
    ready,
    error: storageError,
    retry,
  } = useSession();
  const [query, setQuery] = useState(""),
    [attempt, refresh] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    rows: Locker[];
    error?: string;
  }>();
  const [map, setMap] = useState(false);
  const key = [mode, slot.start, slot.hours, attempt].join("-");
  useEffect(() => {
    if (mode !== "live") return;
    const ctrl = new AbortController();
    let active = true;
    const timer = setTimeout(() => ctrl.abort(), 10000);
    readAvailability(
      process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
      slot,
      ctrl.signal,
    )
      .then((rows) => {
        if (active) setResult({ key, rows });
      })
      .catch((e: Error) => {
        if (active)
          setResult({
            key,
            rows: [],
            error: ctrl.signal.aborted
              ? "Request timed out. Check your connection."
              : e.message,
          });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [mode, slot, key]);
  const demo = mode === "demo",
    rows = demo
      ? available(slot, bookings)
      : result?.key === key
        ? result.rows
        : [];
  const error = demo
    ? storageError
    : result?.key === key
      ? result.error
      : undefined;
  const loading = demo ? !ready : result?.key !== key;
  const filtered = rows.filter((l) =>
    (l.location + " " + l.code)
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <Page>
      <Heading>Discover lockers</Heading>
      <Copy>
        {demo
          ? "Sample lockers on the Ottawa campus."
          : "Available lockers from the customer API."}
      </Copy>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change date and time"
        onPress={() => router.push("/time")}
        style={[s.card, s.between]}
      >
        <CalendarClock color={c.red} />
        <View style={{ flex: 1 }}>
          <Text style={s.strong}>{dateLabel(slot.start)}</Text>
          <Copy>
            {timeLabel(slot.start)} · {slot.hours}{" "}
            {slot.hours === 1 ? "hour" : "hours"}
          </Copy>
        </View>
        <ChevronRight color={c.sub} />
      </Pressable>
      {demo && (
        <>
          <View style={s.wrap}>
            <Chip label="List" selected={!map} onPress={() => setMap(false)} />
            <Chip
              label="Campus map"
              selected={map}
              onPress={() => setMap(true)}
            />
          </View>
          {map && <Campus query={query} onSelect={setQuery} />}
        </>
      )}
      <View style={[s.card, s.row, { paddingVertical: 4 }]}>
        <Search size={20} color={c.sub} />
        <TextInput
          accessibilityLabel="Search lockers"
          placeholder="Building or locker ID"
          placeholderTextColor={c.sub}
          value={query}
          onChangeText={setQuery}
          style={{ flex: 1, minHeight: 46, fontSize: 16, color: c.ink }}
        />
      </View>
      {error ? (
        <View style={s.card}>
          <Text style={s.strong}>Couldn’t load availability</Text>
          <Copy>{error}</Copy>
          <Button
            secondary
            label="Retry"
            onPress={() => (demo ? retry() : refresh((n) => n + 1))}
          />
        </View>
      ) : loading ? (
        <ActivityIndicator accessibilityLabel="Loading lockers" color={c.red} />
      ) : !validSlot(slot) ? (
        <Button
          label="Choose a future time"
          onPress={() => router.push("/time")}
        />
      ) : (
        <>
          <Text style={s.label}>{filtered.length} AVAILABLE</Text>
          {filtered.map((l) => (
            <Pressable
              key={l.id}
              accessibilityRole="button"
              accessibilityLabel={l.code + " at " + l.location}
              onPress={() => {
                select(l);
                router.push("/locker");
              }}
              style={[s.card, s.row]}
            >
              <View
                style={{
                  backgroundColor: c.rose,
                  padding: 13,
                  borderRadius: 13,
                }}
              >
                <LockKeyhole color={c.red} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={s.strong}>{l.code}</Text>
                <Copy>{l.location}</Copy>
              </View>
              <ChevronRight size={20} color={c.sub} />
            </Pressable>
          ))}
          {!filtered.length && (
            <View style={s.card}>
              <Text style={s.strong}>No matching lockers</Text>
              <Copy>Try another building or choose a different time.</Copy>
            </View>
          )}
        </>
      )}
    </Page>
  );
}
