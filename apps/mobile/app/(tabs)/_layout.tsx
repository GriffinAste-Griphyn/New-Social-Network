import type { ComponentProps } from "react"
import Ionicons from "@expo/vector-icons/Ionicons"
import { Redirect, Tabs } from "expo-router"
import { StyleSheet, Text, View } from "react-native"

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
    <View style={styles.tabIcon}>
      <Ionicons size={size} name={name} color={color} />
      {badgeCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {badgeCount}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

function PostTabIcon() {
  return (
    <View style={styles.tabIcon}>
      <View style={styles.postTabIconFill}>
        <Ionicons size={18} name="add" color="#ffffff" />
      </View>
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
          tabBarIcon: () => <PostTabIcon />,
          tabBarLabelStyle: styles.postTabLabel,
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

const styles = StyleSheet.create({
  tabIcon: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  postTabIconFill: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e01616",
  },
  postTabLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 16,
    transform: [{ translateY: 1 }],
  },
  badge: {
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
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 12,
  },
})
