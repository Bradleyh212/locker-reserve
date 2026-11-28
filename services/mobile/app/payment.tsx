import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { CreditCard } from "lucide-react-native";
import { demoRate } from "../src/model";
import { useSession } from "../src/session";
import { Button, c, Copy, Heading, NeedSelection, Page, s } from "../src/ui";
export default function Payment() {
  const { mode, selected, slot, confirm } = useSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (mode !== "demo" || !selected) return <NeedSelection />;
  async function save() {
    setBusy(true);
    try {
      const id = await confirm();
      router.replace({ pathname: "/confirmation", params: { id } });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save the preview. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page back>
      <Heading>Payment preview</Heading>
      <View style={[s.card, { backgroundColor: c.ink, padding: 24, gap: 20 }]}>
        <CreditCard size={32} color="white" />
        <Text style={{ color: "white", fontSize: 36, fontWeight: "700" }}>
          ${(slot.hours * demoRate).toFixed(2)} CAD
        </Text>
        <Text style={{ color: "#E2DCD6" }}>
          {selected.code} · {selected.location}
        </Text>
      </View>
      <Copy>
        No card details are needed. Confirming saves a demo preview on this
        device. No payment or locker hold is created.
      </Copy>
      {!!error && (
        <Text accessibilityRole="alert" style={s.body}>
          {error}
        </Text>
      )}
      <Button
        disabled={busy}
        label={busy ? "Saving…" : "Confirm demo reservation"}
        onPress={save}
      />
    </Page>
  );
}
