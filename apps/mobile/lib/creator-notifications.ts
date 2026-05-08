import Constants from "expo-constants"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

import { getMobileApi, postMobileApi } from "@/lib/mobile-api"

type CreatorNotificationPreferenceResponse = {
  ok: true
  enabled: boolean
}

function getExpoProjectId() {
  const constants = Constants as typeof Constants & {
    easConfig?: { projectId?: string }
  }

  return (
    constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)
      ?.projectId
  )
}

export async function getCreatorNotificationsEnabled(creatorId: string) {
  const payload = await getMobileApi<CreatorNotificationPreferenceResponse>(
    `/api/mobile/creator-notifications?creatorId=${encodeURIComponent(creatorId)}`,
  )

  return payload.enabled
}

async function getRegisteredExpoPushToken() {
  const permissions = await Notifications.getPermissionsAsync()
  const finalPermissions = permissions.granted
    ? permissions
    : await Notifications.requestPermissionsAsync()

  if (!finalPermissions.granted) {
    throw new Error("Notification permission is required to turn this on.")
  }

  const projectId = getExpoProjectId()
  const token = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  )

  await postMobileApi(
    "/api/mobile/push-tokens",
    {
      expoPushToken: token.data,
      platform: Platform.OS,
    },
  )
}

export async function setCreatorNotificationsEnabled(input: {
  creatorId: string
  enabled: boolean
}) {
  if (input.enabled) {
    await getRegisteredExpoPushToken()
  }

  const payload = await postMobileApi<CreatorNotificationPreferenceResponse>(
    "/api/mobile/creator-notifications",
    input,
  )

  return payload.enabled
}
