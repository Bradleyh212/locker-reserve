import { Text, View } from "react-native";
import { useSession } from "../src/session";
import { Chip, Copy, Heading, Page, s } from "../src/ui";
export default function Settings() {
  const { mode, changeMode } = useSession();
  return (
    <Page>
      <Heading>Settings</Heading>
      <View style={s.card}>
        <Text style={s.heading}>Availability source</Text>
        <View style={s.wrap}>
          <Chip
            label="Demo catalog"
            selected={mode === "demo"}
            onPress={() => changeMode("demo")}
          />
          <Chip
            label="Connected API"
            selected={mode === "live"}
            onPress={() => changeMode("live")}
          />
        </View>
        <Copy>
          {mode === "demo"
            ? "Sample campus locations and local reservation previews."
            : "Read-only availability. Access depends on your configured API and permitted network."}
        </Copy>
      </View>
      <View style={s.card}>
        <Text style={s.strong}>Privacy on this device</Text>
        <Copy>
          Only demo previews are saved locally. No account, payment details or
          location permission is required.
        </Copy>
      </View>
    </Page>
  );
}
