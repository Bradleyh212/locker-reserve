import { router, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Compass,
  House,
  LockKeyhole,
  Settings2,
} from "lucide-react-native";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { PropsWithChildren } from "react";
import { useSession } from "./session";
export const c = {
  paper: "#F8F6F1",
  ink: "#252421",
  sub: "#645F59",
  red: "#820C2D",
  rose: "#F4E3E8",
  line: "#DBD6CE",
  green: "#2D6252",
};
export const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  card: {
    backgroundColor: "white",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: c.line,
    gap: 12,
  },
  title: {
    fontSize: 35,
    lineHeight: 40,
    letterSpacing: -1.4,
    fontWeight: "700",
    color: c.ink,
  },
  heading: {
    fontSize: 21,
    fontWeight: "700",
    letterSpacing: -0.5,
    color: c.ink,
  },
  body: { fontSize: 16, lineHeight: 23, color: c.sub },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 1.4, color: c.red },
  strong: { fontSize: 17, fontWeight: "600", color: c.ink },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  divider: { height: 1, backgroundColor: c.line },
});
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <View style={s.row}>
      <View style={{ padding: 9, backgroundColor: c.red, borderRadius: 12 }}>
        <LockKeyhole size={21} color="white" />
      </View>
      <Text
        style={[
          s.strong,
          { color: light ? "white" : c.ink, letterSpacing: -0.6 },
        ]}
      >
        LockerReserve
      </Text>
    </View>
  );
}
export function Heading({ children }: PropsWithChildren) {
  return (
    <Text accessibilityRole="header" style={s.title}>
      {children}
    </Text>
  );
}
export function Copy({
  children,
  style,
}: PropsWithChildren<{ style?: TextStyle }>) {
  return <Text style={[s.body, style]}>{children}</Text>;
}
export function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.between,
        {
          minHeight: 54,
          paddingHorizontal: 19,
          borderRadius: 15,
          backgroundColor: secondary ? "white" : c.red,
          borderWidth: 1,
          borderColor: secondary ? c.line : c.red,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text style={[s.strong, { flex: 1, color: secondary ? c.ink : "white" }]}>
        {label}
      </Text>
      <ArrowRight size={20} color={secondary ? c.red : "white"} />
    </Pressable>
  );
}
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: "center",
        borderRadius: 12,
        paddingHorizontal: 15,
        borderWidth: 1,
        borderColor: selected ? c.red : c.line,
        backgroundColor: selected ? c.red : "white",
      }}
    >
      <Text style={{ fontWeight: "600", color: selected ? "white" : c.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}
export function ModeLabel() {
  const { mode } = useSession();
  return (
    <Text
      style={{
        fontSize: 12,
        fontWeight: "700",
        color: c.red,
        backgroundColor: c.rose,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 12,
      }}
    >
      {mode === "demo" ? "Demo mode" : "Read-only API"}
    </Text>
  );
}
const tabs = [
  { path: "/home", label: "Home", Icon: House },
  { path: "/discover", label: "Discover", Icon: Compass },
  { path: "/reservations", label: "Saved", Icon: Bookmark },
  { path: "/settings", label: "Settings", Icon: Settings2 },
] as const;
export function Page({
  children,
  back = false,
}: PropsWithChildren<{ back?: boolean }>) {
  const path = usePathname();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }}>
      <StatusBar style="dark" />
      <View
        style={{ width: "100%", maxWidth: 660, flex: 1, alignSelf: "center" }}
      >
        <View
          style={[s.between, { paddingHorizontal: 22, paddingVertical: 14 }]}
        >
          {back ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/home")
              }
              style={[s.row, { minHeight: 44 }]}
            >
              <ArrowLeft color={c.red} size={20} />
              <Text style={s.strong}>Back</Text>
            </Pressable>
          ) : (
            <Brand />
          )}
          <ModeLabel />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: 22,
            paddingTop: 12,
            paddingBottom: 30,
            gap: 18,
          }}
        >
          {children}
        </ScrollView>
        <View
          style={{
            flexDirection: "row",
            borderTopWidth: 1,
            borderColor: c.line,
            backgroundColor: c.paper,
            paddingVertical: 6,
          }}
        >
          {tabs.map(({ path: to, label, Icon }) => (
            <Pressable
              key={to}
              accessibilityRole="button"
              accessibilityState={{ selected: path === to }}
              onPress={() => router.navigate(to)}
              style={{
                flex: 1,
                gap: 3,
                minHeight: 52,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon color={path === to ? c.red : c.sub} size={21} />
              <Text
                style={{
                  color: path === to ? c.red : c.sub,
                  fontSize: 12,
                  fontWeight: "600",
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}
export function NeedSelection() {
  return (
    <Page back>
      <Heading>Choose your locker</Heading>
      <Copy>Select an available locker for your time window to continue.</Copy>
      <Button
        label="Find a locker"
        onPress={() => router.replace("/discover")}
      />
    </Page>
  );
}
