import { router } from "expo-router";
import { Text, View } from "react-native";
import { demoRate } from "../src/model";
import { useSession } from "../src/session";
import { Ticket } from "../src/ticket";
import { Button, Copy, Heading, NeedSelection, Page, s } from "../src/ui";
export default function Summary() {
  const { mode, slot, selected } = useSession();
  if (mode !== "demo" || !selected) return <NeedSelection />;
  return (
    <Page back>
      <Heading>Review reservation</Heading>
      <Ticket locker={selected} slot={slot} />
      <View style={s.card}>
        <Text style={s.strong}>Price summary</Text>
        <Copy>
          {slot.hours} × ${demoRate.toFixed(2)} per hour
        </Copy>
        <View style={s.divider} />
        <View style={s.between}>
          <Text style={s.strong}>Demo total</Text>
          <Text style={s.heading}>
            ${(slot.hours * demoRate).toFixed(2)} CAD
          </Text>
        </View>
      </View>
      <Button
        label="Continue to payment preview"
        onPress={() => router.push("/payment")}
      />
    </Page>
  );
}
