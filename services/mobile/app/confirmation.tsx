import { router, useLocalSearchParams } from "expo-router";
import { Check } from "lucide-react-native";
import { View } from "react-native";
import { useSession } from "../src/session";
import { Button, Copy, Heading, Page } from "../src/ui";
import { Ticket } from "../src/ticket";
export default function Confirmation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bookings, ready, error } = useSession();
  const item = bookings.find((b) => b.id === id);
  return (
    <Page>
      <Heading>
        {item
          ? "Demo reservation saved"
          : ready
            ? "Preview unavailable"
            : "Opening preview"}
      </Heading>
      {item ? (
        <>
          <View
            style={{
              alignSelf: "flex-start",
              padding: 15,
              backgroundColor: "#DFEDE3",
              borderRadius: 40,
            }}
          >
            <Check color="#28553C" />
          </View>
          <Ticket locker={item.locker} slot={item} />
          <Copy>
            This preview is stored on your device. It does not provide physical
            locker access.
          </Copy>
        </>
      ) : (
        <Copy>
          {error || "Your saved previews are available in My reservations."}
        </Copy>
      )}
      <Button
        label="View my reservations"
        onPress={() => router.replace("/reservations")}
      />
    </Page>
  );
}
