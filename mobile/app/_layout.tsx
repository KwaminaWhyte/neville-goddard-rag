import "react-native-gesture-handler";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../lib/auth";
import { colors, font } from "../lib/theme";

// Routes that an unauthenticated user is allowed to see.
const PUBLIC_ROUTES = ["login", "signup"];

function ProfileButton() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push("/profile")} hitSlop={8}>
      <Text style={{ color: colors.gold, fontFamily: font.serif, fontSize: font.sizes.md }}>
        Profile
      </Text>
    </Pressable>
  );
}

function RootStack() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const onPublic = PUBLIC_ROUTES.includes(segments[0] as string);
    if (!user && !onPublic) {
      router.replace("/login");
    } else if (user && onPublic) {
      router.replace("/");
    }
  }, [user, loading, segments, router]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.base,
        }}
      >
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  return (
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
      <Stack.Screen
        name="index"
        options={{ title: "The Law", headerRight: () => <ProfileButton /> }}
      />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="signup" options={{ headerShown: false }} />
      <Stack.Screen name="profile" options={{ title: "Profile" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.base }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthProvider>
          <RootStack />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
