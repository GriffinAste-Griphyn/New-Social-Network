import type { ComponentProps } from "react"
import Ionicons from "@expo/vector-icons/Ionicons"
import { Redirect, Tabs } from "expo-router"
import { Text, View } from "react-native"

import { useAuthFlow } from "@/lib/auth-flow"

function TabIcon({
  badgeCount = 0,
  name,
  color,
  size = 24,
}: {
  badgeCount?: number
  name: ComponentProps<typeof Ionicons>["name"]
  color: string
  size?: number
}) {
  return (
    <View
      style={{
        width: 28,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons size={size} name={name} color={color} />
      {badgeCount > 0 ? (
        <View
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#e01616",
            paddingHorizontal: 4,
          }}
        >
          <Text
            style={{
              color: "#ffffff",
              fontSize: 10,
              fontFamily: "Inter_700Bold",
              fontWeight: "700",
              lineHeight: 12,
            }}
          >
            {badgeCount}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

export default function TabLayout() {
  const { isComplete } = useAuthFlow()

  if (!isComplete) {
    return <Redirect href="/auth" />
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#111827",
        tabBarInactiveTintColor: "#6b7280",
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#e5e7eb",
          height: 88,
          paddingTop: 10,
          paddingBottom: 24,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: "Inter_600SemiBold",
          fontWeight: "600",
          letterSpacing: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => (
            <TabIcon name="home-outline" color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="following"
        options={{
          title: "Following",
          tabBarIcon: ({ color }) => (
            <TabIcon name="play-circle-outline" color={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="post"
        options={{
          title: "Post",
          tabBarIcon: ({ color }) => (
            <TabIcon name="add-circle-outline" color={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: "Discover",
          tabBarIcon: ({ color }) => (
            <TabIcon name="compass-outline" color={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="replies"
        options={{
          title: "Replies",
          tabBarIcon: ({ color }) => (
            <TabIcon
              name="chatbubble-ellipses-outline"
              color={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          href: null,
        }}
      />
    </Tabs>
  )
}
