import { router } from "expo-router";
import { CalendarDays, MapPin } from "lucide-react-native";
import { ImageBackground, Text, View } from "react-native";
import { useSession } from "../src/session";
import { Button, c, Copy, Heading, Page, s } from "../src/ui";
import { dateLabel, timeLabel } from "../src/model";
export default function Home() {
  const { bookings, mode } = useSession();
  return (
    <Page>
      <Text style={s.label}>CAMPUS LOCKERS</Text>
      <Heading>Plan your campus day.</Heading>
      <View
        style={{ borderRadius: 20, overflow: "hidden", backgroundColor: c.ink }}
      >
        <ImageBackground
          source={require("../assets/campus.jpg")}
          style={{ height: 160, justifyContent: "flex-end" }}
        >
          <View
            style={[
              s.row,
              {
                alignSelf: "flex-start",
                margin: 12,
                backgroundColor: c.ink,
                padding: 8,
                borderRadius: 10,
              },
            ]}
          >
            <MapPin size={16} color="white" />
            <Text style={{ color: "white" }}>University of Ottawa</Text>
          </View>
        </ImageBackground>
        <View style={{ padding: 19, gap: 14 }}>
          <Text style={[s.heading, { color: "white" }]}>
            Find a campus locker
          </Text>
          <Copy style={{ color: "#E8E0DC" }}>
            {mode === "demo"
              ? "Explore sample locations and try a reservation."
              : "Check availability for your preferred time."}
          </Copy>
          <Button
            label="Browse lockers"
            onPress={() => router.push("/discover")}
          />
        </View>
      </View>
      <View style={s.row}>
        <CalendarDays color={c.red} />
        <Text style={s.heading}>Your reservations</Text>
      </View>
      <View style={s.card}>
        <Text style={s.strong}>
          {bookings[0] ? "Latest demo preview" : "No previews saved yet"}
        </Text>
        <Copy>
          {bookings[0]
            ? bookings[0].locker.location +
              " · " +
              dateLabel(bookings[0].start) +
              " at " +
              timeLabel(bookings[0].start)
            : "Your demo reservations will appear here after checkout."}
        </Copy>
        <Button
          secondary
          label="My reservations"
          onPress={() => router.push("/reservations")}
        />
      </View>
    </Page>
  );
}
