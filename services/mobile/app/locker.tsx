import { router } from "expo-router";
import { Text, View } from "react-native";
import { Button, Copy, Heading, NeedSelection, Page, s } from "../src/ui";
import { Ticket } from "../src/ticket";
import { useSession } from "../src/session";
export default function Details() {
  const { selected, slot, mode } = useSession();
  if (!selected) return <NeedSelection />;
  return (
    <Page back>
      <Heading>Locker details</Heading>
      <Ticket locker={selected} slot={slot} />
      <View style={s.card}>
        <Text style={s.label}>
          {mode === "demo" ? "DEMO RATE" : "CONNECTED AVAILABILITY"}
        </Text>
        <Text style={s.heading}>
          {mode === "demo" ? "$2.00 CAD / hour" : "Available for this window"}
        </Text>
        <Copy>
          {mode === "demo"
            ? "Try the booking flow with illustrative campus inventory."
            : "The availability API provides no price. Live checkout is unavailable in this build."}
        </Copy>
      </View>
      <Button
        label={mode === "demo" ? "Review reservation" : "Back to discovery"}
        onPress={() =>
          mode === "demo"
            ? router.push("/summary")
            : router.replace("/discover")
        }
      />
      <Button
        secondary
        label="Change date and time"
        onPress={() => router.push("/time")}
      />
    </Page>
  );
}
