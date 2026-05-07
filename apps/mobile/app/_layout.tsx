import {
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter"
import { DefaultTheme, ThemeProvider } from "@react-navigation/native"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { Platform } from "react-native"

import { AuthFlowProvider } from "@/lib/auth-flow"
import { FollowStateProvider } from "@/lib/follow-state"

const systemFontFamily = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: "System",
})

const theme = {
  ...DefaultTheme,
  fonts: {
    regular: {
      fontFamily: systemFontFamily,
      fontWeight: "400" as const,
    },
    medium: {
      fontFamily: systemFontFamily,
      fontWeight: "500" as const,
    },
    bold: {
      fontFamily: systemFontFamily,
      fontWeight: "700" as const,
    },
    heavy: {
      fontFamily: systemFontFamily,
      fontWeight: "700" as const,
    },
  },
  colors: {
    ...DefaultTheme.colors,
    background: "#f3f4f6",
    card: "#ffffff",
    primary: "#111827",
    text: "#111827",
    border: "#e5e7eb",
  },
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_700Bold,
  })

  if (!fontsLoaded) {
    return null
  }

  return (
    <AuthFlowProvider>
      <FollowStateProvider>
        <ThemeProvider value={theme}>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#f3f4f6" },
            }}
          >
            <Stack.Screen name="auth" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="creator/[id]" />
            <Stack.Screen name="creator-stats" />
            <Stack.Screen name="earnings" />
            <Stack.Screen name="followers" />
            <Stack.Screen name="payouts" />
            <Stack.Screen name="replies/[creatorId]" />
          </Stack>
        </ThemeProvider>
      </FollowStateProvider>
    </AuthFlowProvider>
  )
}
