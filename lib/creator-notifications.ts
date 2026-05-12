import { randomUUID } from "node:crypto"

import { and, eq, inArray } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  creatorNotificationPreferences,
  mobilePushTokens,
  users,
} from "@/lib/db/schema"
import {
  assertUsersCanConnect,
  getBlockedPeerIds,
  isBlockedBetween,
} from "@/lib/social-safety"

const expoPushEndpoint = "https://exp.host/--/api/v2/push/send"
const expoPushTokenPattern = /^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/

type ExpoPushMessage = {
  to: string
  title: string
  body: string
  data: {
    type: "creator_story_posted"
    creatorId: string
    storyId: string
  }
  sound: "default"
}

function isExpoPushToken(value: string) {
  return expoPushTokenPattern.test(value)
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }

  return chunks
}

export async function registerMobilePushToken(input: {
  userId: string
  expoPushToken: string
  platform: string | null
}) {
  if (!isExpoPushToken(input.expoPushToken)) {
    throw new Error("That push token is not valid.")
  }

  const now = new Date()

  await getDb()
    .insert(mobilePushTokens)
    .values({
      id: `mobile-push-token-${randomUUID()}`,
      userId: input.userId,
      expoPushToken: input.expoPushToken,
      platform: input.platform,
      enabled: true,
      lastRegisteredAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: mobilePushTokens.expoPushToken,
      set: {
        userId: input.userId,
        platform: input.platform,
        enabled: true,
        lastRegisteredAt: now,
        updatedAt: now,
      },
    })
}

export async function getCreatorNotificationPreference(input: {
  subscriberId: string
  creatorId: string
}) {
  if (await isBlockedBetween(input.subscriberId, input.creatorId)) {
    return false
  }

  const [preference] = await getDb()
    .select({ enabled: creatorNotificationPreferences.enabled })
    .from(creatorNotificationPreferences)
    .where(
      and(
        eq(creatorNotificationPreferences.subscriberId, input.subscriberId),
        eq(creatorNotificationPreferences.creatorId, input.creatorId),
      ),
    )
    .limit(1)

  return preference?.enabled ?? false
}

export async function setCreatorNotificationPreference(input: {
  subscriberId: string
  creatorId: string
  enabled: boolean
}) {
  if (input.subscriberId === input.creatorId) {
    throw new Error("You cannot subscribe to your own story notifications.")
  }

  const [creator] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, input.creatorId))
    .limit(1)

  if (!creator) {
    throw new Error("That creator does not exist.")
  }

  await assertUsersCanConnect({
    actorId: input.subscriberId,
    targetUserId: input.creatorId,
  })

  const now = new Date()

  await getDb()
    .insert(creatorNotificationPreferences)
    .values({
      subscriberId: input.subscriberId,
      creatorId: input.creatorId,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        creatorNotificationPreferences.subscriberId,
        creatorNotificationPreferences.creatorId,
      ],
      set: {
        enabled: input.enabled,
        updatedAt: now,
      },
    })
}

export async function notifyCreatorStoryPosted(input: {
  creatorId: string
  creatorName: string
  storyId: string
  caption: string | null
}) {
  const preferences = await getDb()
    .select({ subscriberId: creatorNotificationPreferences.subscriberId })
    .from(creatorNotificationPreferences)
    .where(
      and(
        eq(creatorNotificationPreferences.creatorId, input.creatorId),
        eq(creatorNotificationPreferences.enabled, true),
      ),
    )

  const subscriberIds = preferences
    .map((preference) => preference.subscriberId)
    .filter((subscriberId) => subscriberId !== input.creatorId)
  const blockedPeerIds = await getBlockedPeerIds(input.creatorId)
  const eligibleSubscriberIds = subscriberIds.filter(
    (subscriberId) => !blockedPeerIds.has(subscriberId),
  )

  if (eligibleSubscriberIds.length === 0) {
    return
  }

  const tokens = await getDb()
    .select({ expoPushToken: mobilePushTokens.expoPushToken })
    .from(mobilePushTokens)
    .where(
      and(
        inArray(mobilePushTokens.userId, eligibleSubscriberIds),
        eq(mobilePushTokens.enabled, true),
      ),
    )

  const messages: ExpoPushMessage[] = tokens
    .map((token) => token.expoPushToken)
    .filter(isExpoPushToken)
    .map((token) => ({
      to: token,
      title: `${input.creatorName} posted a story`,
      body: input.caption?.trim() || "Tap to watch it now.",
      data: {
        type: "creator_story_posted",
        creatorId: input.creatorId,
        storyId: input.storyId,
      },
      sound: "default",
    }))

  await Promise.all(
    chunk(messages, 100).map(async (messageChunk) => {
      if (messageChunk.length === 0) {
        return
      }

      await fetch(expoPushEndpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messageChunk),
      }).catch(() => undefined)
    }),
  )
}
