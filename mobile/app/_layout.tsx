import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors, font } from "../lib/theme";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.base }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            // Native header owns the title + back button. Screens let the OS inset
            // their scroll content under it (contentInsetAdjustmentBehavior),
            // so there's no manual safe-area padding stacking on top of it.
            headerStyle: { backgroundColor: colors.base },
            headerTintColor: colors.gold,
            headerTitleStyle: { color: colors.gold, fontFamily: font.serif },
            headerShadowVisible: false,
            headerBackButtonDisplayMode: "minimal",
            contentStyle: { backgroundColor: colors.base },
          }}
        >
          <Stack.Screen name="index" options={{ title: "The Law" }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
