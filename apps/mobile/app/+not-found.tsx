import { Link, Stack } from "expo-router"
import { StyleSheet, Text, View } from "react-native"

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Missing" }} />
      <View style={styles.container}>
        <Text style={styles.title}>That screen is not in the mobile app.</Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Go back home</Text>
        </Link>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f3f4f6",
  },
  title: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
  },
  link: {
    marginTop: 16,
    paddingVertical: 10,
  },
  linkText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: "#2563eb",
  },
})
