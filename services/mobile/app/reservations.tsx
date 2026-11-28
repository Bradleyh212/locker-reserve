import { router } from "expo-router";
import { Text, View } from "react-native";
import { Ticket } from "../src/ticket";
import { useSession } from "../src/session";
import { Button, Copy, Heading, Page, s } from "../src/ui";
export default function Reservations() {
  const { bookings, error, retry, ready } = useSession();
  return (
    <Page>
      <Heading>My reservations</Heading>
      <Copy>Demo previews saved on this device.</Copy>
      {error ? (
        <>
          <Copy>{error}</Copy>
          <Button label="Retry" onPress={retry} />
        </>
      ) : !ready ? (
        <Copy>Loading saved previews…</Copy>
      ) : bookings.length ? (
        bookings.map((b) => <Ticket key={b.id} locker={b.locker} slot={b} />)
      ) : (
        <View style={s.card}>
          <Text style={s.heading}>No saved previews</Text>
          <Copy>
            Choose a demo locker and complete the payment preview to save your
            first reservation.
          </Copy>
          <Button
            label="Find a locker"
            onPress={() => router.navigate("/discover")}
          />
        </View>
      )}
    </Page>
  );
}
