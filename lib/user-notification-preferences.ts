import { and, eq, inArray } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { userNotificationPreferences } from "@/lib/db/schema"

export const userNotificationPreferenceTypes = [
  "creator_stories",
  "replies",
  "follows",
] as const

export type UserNotificationPreferenceType =
  (typeof userNotificationPreferenceTypes)[number]

export type UserNotificationPreference = {
  type: UserNotificationPreferenceType
  enabled: boolean
}

const defaultPreferences = new Map<UserNotificationPreferenceType, boolean>(
  userNotificationPreferenceTypes.map((type) => [type, true]),
)

export function defaultUserNotificationPreferences() {
  return userNotificationPreferenceTypes.map((type) => ({
    type,
    enabled: defaultPreferences.get(type) ?? true,
  }))
}

export async function getUserNotificationPreferences(userId: string) {
  const storedPreferences = await getDb()
    .select({
      type: userNotificationPreferences.type,
      enabled: userNotificationPreferences.enabled,
    })
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId))

  const preferences = new Map<UserNotificationPreferenceType, boolean>(
    defaultUserNotificationPreferences().map((preference) => [
      preference.type,
      preference.enabled,
    ]),
  )

  for (const preference of storedPreferences) {
    preferences.set(preference.type, preference.enabled)
  }

  return userNotificationPreferenceTypes.map((type) => ({
    type,
    enabled: preferences.get(type) ?? true,
  }))
}

export async function setUserNotificationPreferences(input: {
  userId: string
  preferences: UserNotificationPreference[]
}) {
  const preferences = Array.from(
    new Map(
      input.preferences.map((preference) => [preference.type, preference]),
    ).values(),
  )

  if (preferences.length === 0) {
    return getUserNotificationPreferences(input.userId)
  }

  const now = new Date()

  await Promise.all(
    preferences.map((preference) =>
      getDb()
        .insert(userNotificationPreferences)
        .values({
          userId: input.userId,
          type: preference.type,
          enabled: preference.enabled,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            userNotificationPreferences.userId,
            userNotificationPreferences.type,
          ],
          set: {
            enabled: preference.enabled,
            updatedAt: now,
          },
        }),
    ),
  )

  return getUserNotificationPreferences(input.userId)
}

export async function getUsersEnabledForNotificationType(input: {
  userIds: string[]
  type: UserNotificationPreferenceType
}) {
  if (input.userIds.length === 0) {
    return new Set<string>()
  }

  const disabledRows = await getDb()
    .select({ userId: userNotificationPreferences.userId })
    .from(userNotificationPreferences)
    .where(
      and(
        inArray(userNotificationPreferences.userId, input.userIds),
        eq(userNotificationPreferences.type, input.type),
        eq(userNotificationPreferences.enabled, false),
      ),
    )

  const disabledUserIds = new Set(disabledRows.map((row) => row.userId))

  return new Set(input.userIds.filter((userId) => !disabledUserIds.has(userId)))
}
