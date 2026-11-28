import { Pressable, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { MapPin } from "lucide-react-native";
import { c } from "./ui";
const places = [
  {
    name: "University Centre",
    short: "University Centre",
    left: "32%",
    top: 65,
  },
  { name: "Morisset Library", short: "Morisset", left: "12%", top: 135 },
  { name: "STEM Complex", short: "STEM", left: "68%", top: 24 },
] as const;
export function Campus({
  query,
  onSelect,
}: {
  query: string;
  onSelect: (location: string) => void;
}) {
  return (
    <View
      style={{
        backgroundColor: "#E8E7DD",
        borderRadius: 18,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: c.line,
      }}
    >
      <View style={{ height: 204 }}>
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 380 210"
          preserveAspectRatio="none"
          accessible={false}
        >
          <Rect width={380} height={210} fill="#EAE7DF" />
          <Path d="M0 20 Q60 70 80 210 L0 210Z" fill="#BCD7D7" />
          <Path
            d="M20 -10 L72 20 112 0 78 85 67 102Z M245 122 L335 92 395 165 305 205Z"
            fill="#CFDAC4"
          />
          <Path
            d="M68 0 L134 210 M168 -10 L206 210 M326 -10 L252 210 M10 115 L390 33 M45 185 L390 104"
            stroke="#FDFBF7"
            strokeWidth="11"
          />
          <Path
            d="M99 36l41 -9 9 41 -37 9z M205 16l51 -9 8 34 -53 10z M205 89l44 -9 5 21 -44 11z M158 147l28 -6 7 40 -29 6z M310 70l38 -10 6 22 -39 8z"
            fill="#CEC9BF"
          />
        </Svg>
        {places.map((p) => (
          <Pressable
            key={p.name}
            accessibilityRole="button"
            accessibilityLabel={"Filter by " + p.name}
            accessibilityState={{ selected: query === p.name }}
            onPress={() => onSelect(query === p.name ? "" : p.name)}
            style={{
              position: "absolute",
              left: p.left,
              top: p.top,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                backgroundColor: c.red,
                borderRadius: 16,
                padding: 6,
                borderWidth: 2,
                borderColor: "white",
              }}
            >
              <MapPin size={17} color="white" />
            </View>
            <Text
              style={{
                fontWeight: "700",
                fontSize: 12,
                color: c.ink,
                backgroundColor: "#F8F6F1",
                paddingHorizontal: 4,
              }}
            >
              {p.short}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text
        style={{
          padding: 10,
          color: c.sub,
          fontSize: 13,
          backgroundColor: "#F2F0EA",
        }}
      >
        Illustrative campus map · Tap a building to filter
      </Text>
    </View>
  );
}
