import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Image, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MapPin } from "lucide-react-native";
import { Brand, Button, c } from "../src/ui";
export default function Welcome() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.ink }}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "space-between",
          width: "100%",
          maxWidth: 660,
          alignSelf: "center",
          padding: 24,
          gap: 24,
        }}
      >
        <Brand light />
        <View style={{ gap: 12 }}>
          <Text
            accessibilityRole="header"
            style={{
              color: "white",
              fontSize: 54,
              fontWeight: "700",
              letterSpacing: -2.8,
              lineHeight: 56,
            }}
          >
            Your campus.{"\n"}Your space.
          </Text>
          <Text style={{ color: "#E6E0D8", fontSize: 18, lineHeight: 26 }}>
            Find a locker for the hours between classes.
          </Text>
        </View>
        <View
          style={{
            overflow: "hidden",
            borderRadius: 22,
            backgroundColor: "#36332F",
          }}
        >
          <Image
            source={require("../assets/campus.jpg")}
            accessibilityLabel="Students walking outside a campus building"
            style={{ width: "100%", aspectRatio: 1.7 }}
          />
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              padding: 14,
              alignItems: "center",
            }}
          >
            <MapPin color="#F5BEC9" size={17} />
            <Text style={{ color: "white", fontSize: 14 }}>
              University of Ottawa campus
            </Text>
          </View>
        </View>
        <View style={{ gap: 12 }}>
          <Button
            label="Explore campus"
            onPress={() => router.replace("/home")}
          />
          <Text style={{ color: "#D5CEC7", textAlign: "center" }}>
            Starts in demo mode · No account required
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
