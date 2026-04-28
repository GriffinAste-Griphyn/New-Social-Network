import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
  useFonts,
} from "@expo-google-fonts/inter"
import { DefaultTheme, ThemeProvider } from "@react-navigation/native"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"

import { AuthFlowProvider } from "@/lib/auth-flow"
import { FollowStateProvider } from "@/lib/follow-state"
import { mobileFontFamily } from "@/lib/typography"

const theme = {
  ...DefaultTheme,
  fonts: {
    regular: {
      fontFamily: mobileFontFamily.regular,
      fontWeight: "400" as const,
    },
    medium: {
      fontFamily: mobileFontFamily.medium,
      fontWeight: "500" as const,
    },
    bold: {
      fontFamily: mobileFontFamily.bold,
      fontWeight: "700" as const,
    },
    heavy: {
      fontFamily: mobileFontFamily.black,
      fontWeight: "900" as const,
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
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
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
            <Stack.Screen name="replies/[creatorId]" />
          </Stack>
        </ThemeProvider>
      </FollowStateProvider>
    </AuthFlowProvider>
  )
}
