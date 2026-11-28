import { Stack } from "expo-router";
import { Provider } from "../src/session";
export default function Layout() {
  return (
    <Provider>
      <Stack screenOptions={{ headerShown: false }} />
    </Provider>
  );
}
