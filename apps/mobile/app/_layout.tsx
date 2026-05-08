import {
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter"
import { DefaultTheme, ThemeProvider } from "@react-navigation/native"
import * as Notifications from "expo-notifications"
import { Stack, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect } from "react"
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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export default function RootLayout() {
  const router = useRouter()
  const [fontsLoaded] = useFonts({
    Inter_700Bold,
  })

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const storyId = response.notification.request.content.data.storyId

        if (typeof storyId === "string" && storyId.length > 0) {
          router.push(`/story/${storyId}`)
        }
      },
    )

    return () => {
      subscription.remove()
    }
  }, [router])

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
            <Stack.Screen name="my-story-stats" />
            <Stack.Screen name="payouts" />
            <Stack.Screen name="replies/[creatorId]" />
          </Stack>
        </ThemeProvider>
      </FollowStateProvider>
    </AuthFlowProvider>
  )
}
