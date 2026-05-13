import { randomUUID, sign as signData } from "node:crypto"
import { connect as connectHttp2, constants as http2Constants } from "node:http2"

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
import { env } from "@/lib/env"

const expoPushEndpoint = "https://exp.host/--/api/v2/push/send"
const expoPushTokenPattern = /^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/
const apnsDeviceTokenPattern = /^[a-f0-9]{64,}$/i

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

type ApnsPushMessage = {
  token: string
  environment: "sandbox" | "production"
  title: string
  body: string
  data: {
    type: "creator_story_posted"
    creatorId: string
    storyId: string
  }
}

type ApnsConfig = {
  keyId: string
  teamId: string
  bundleId: string
  privateKey: string
}

function isExpoPushToken(value: string) {
  return expoPushTokenPattern.test(value)
}

function isApnsDeviceToken(value: string) {
  return apnsDeviceTokenPattern.test(value)
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }

  return chunks
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
}

function normalizePrivateKey(value: string) {
  const trimmedValue = value.trim()

  if (trimmedValue.includes("BEGIN PRIVATE KEY")) {
    return trimmedValue.replace(/\\n/g, "\n")
  }

  return Buffer.from(trimmedValue, "base64").toString("utf8")
}

function getApnsConfig(): ApnsConfig | null {
  if (
    !env.APNS_KEY_ID ||
    !env.APNS_TEAM_ID ||
    !env.APNS_BUNDLE_ID ||
    !env.APNS_PRIVATE_KEY
  ) {
    return null
  }

  return {
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    bundleId: env.APNS_BUNDLE_ID,
    privateKey: normalizePrivateKey(env.APNS_PRIVATE_KEY),
  }
}

function createApnsJwt(config: ApnsConfig) {
  const header = base64Url(
    JSON.stringify({
      alg: "ES256",
      kid: config.keyId,
    }),
  )
  const payload = base64Url(
    JSON.stringify({
      iss: config.teamId,
      iat: Math.floor(Date.now() / 1000),
    }),
  )
  const signingInput = `${header}.${payload}`
  const signature = signData("sha256", Buffer.from(signingInput), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  })

  return `${signingInput}.${base64Url(signature)}`
}

function apnsHost(environment: "sandbox" | "production") {
  return environment === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com"
}

async function sendApnsMessage(input: {
  config: ApnsConfig
  jwt: string
  message: ApnsPushMessage
}) {
  const client = connectHttp2(apnsHost(input.message.environment))

  await new Promise<void>((resolve) => {
    client.once("error", () => resolve())

    const request = client.request({
      [http2Constants.HTTP2_HEADER_METHOD]: http2Constants.HTTP2_METHOD_POST,
      [http2Constants.HTTP2_HEADER_PATH]: `/3/device/${input.message.token}`,
      authorization: `bearer ${input.jwt}`,
      "apns-topic": input.config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
    })

    request.setEncoding("utf8")
    request.once("error", () => resolve())
    request.once("response", () => undefined)
    request.once("end", () => resolve())
    request.end(
      JSON.stringify({
        aps: {
          alert: {
            title: input.message.title,
            body: input.message.body,
          },
          sound: "default",
        },
        ...input.message.data,
      }),
    )
    request.resume()
  }).finally(() => {
    client.close()
  })
}

async function sendApnsPushNotifications(messages: ApnsPushMessage[]) {
  if (messages.length === 0) {
    return
  }

  const config = getApnsConfig()

  if (!config) {
    return
  }

  const jwt = createApnsJwt(config)

  await Promise.all(
    messages.map((message) =>
      sendApnsMessage({
        config,
        jwt,
        message,
      }).catch(() => undefined),
    ),
  )
}

export async function registerMobilePushToken(input: {
  userId: string
  expoPushToken?: string | null
  apnsDeviceToken?: string | null
  apnsEnvironment?: "sandbox" | "production" | null
  platform: string | null
}) {
  const expoPushToken = input.expoPushToken?.trim() || null
  const apnsDeviceToken = input.apnsDeviceToken?.trim().toLowerCase() || null
  const pushProvider = apnsDeviceToken ? "apns" : "expo"

  if (expoPushToken && !isExpoPushToken(expoPushToken)) {
    throw new Error("That push token is not valid.")
  }

  if (apnsDeviceToken && !isApnsDeviceToken(apnsDeviceToken)) {
    throw new Error("That APNs device token is not valid.")
  }

  if (!expoPushToken && !apnsDeviceToken) {
    throw new Error("Register a push token before enabling notifications.")
  }

  const now = new Date()
  const storedExpoToken = expoPushToken ?? `apns:${apnsDeviceToken}`

  await getDb()
    .insert(mobilePushTokens)
    .values({
      id: `mobile-push-token-${randomUUID()}`,
      userId: input.userId,
      expoPushToken: storedExpoToken,
      apnsDeviceToken,
      pushProvider,
      apnsEnvironment: apnsDeviceToken
        ? input.apnsEnvironment ?? "production"
        : null,
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
        apnsDeviceToken,
        pushProvider,
        apnsEnvironment: apnsDeviceToken
          ? input.apnsEnvironment ?? "production"
          : null,
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
    .select({
      expoPushToken: mobilePushTokens.expoPushToken,
      apnsDeviceToken: mobilePushTokens.apnsDeviceToken,
      pushProvider: mobilePushTokens.pushProvider,
      apnsEnvironment: mobilePushTokens.apnsEnvironment,
    })
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
  const apnsMessages: ApnsPushMessage[] = tokens
    .filter(
      (token) =>
        token.pushProvider === "apns" &&
        token.apnsDeviceToken &&
        isApnsDeviceToken(token.apnsDeviceToken),
    )
    .map((token) => ({
      token: token.apnsDeviceToken as string,
      environment:
        token.apnsEnvironment === "sandbox" ||
        token.apnsEnvironment === "production"
          ? token.apnsEnvironment
          : env.APNS_ENVIRONMENT,
      title: `${input.creatorName} posted a story`,
      body: input.caption?.trim() || "Tap to watch it now.",
      data: {
        type: "creator_story_posted",
        creatorId: input.creatorId,
        storyId: input.storyId,
      },
    }))

  await Promise.all(
    [
      ...chunk(messages, 100).map(async (messageChunk) => {
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
      sendApnsPushNotifications(apnsMessages),
    ],
  )
}
