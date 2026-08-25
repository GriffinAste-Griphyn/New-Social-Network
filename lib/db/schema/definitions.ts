import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

export const storyAssetKind = pgEnum("story_asset_kind", ["image", "video"])
export const mediaAssetPurpose = pgEnum("media_asset_purpose", [
  "story",
  "story_reply",
  "avatar",
])
export const mediaAssetStatus = pgEnum("media_asset_status", [
  "processing",
  "ready",
  "flagged",
  "rejected",
  "deleted",
  "error",
])
export const mediaScanStatus = pgEnum("media_scan_status", [
  "pending",
  "passed",
  "flagged",
  "failed",
  "skipped",
])
export const mediaStorageProvider = pgEnum("media_storage_provider", [
  "local",
  "vercel-blob",
  "cloudflare-stream",
])
export const storyStatus = pgEnum("story_status", [
  "processing",
  "live",
  "expired",
  "removed",
])
export const storyElementKind = pgEnum("story_element_kind", [
  "text",
  "sticker",
  "link",
  "quote_reply",
])
export const storyInteractionKind = pgEnum("story_interaction_kind", [
  "reply",
  "comment",
  "reaction",
])
export const notificationType = pgEnum("notification_type", [
  "follow",
  "reply",
])
export const userNotificationPreferenceType = pgEnum(
  "user_notification_preference_type",
  ["creator_stories", "replies", "follows"],
)
export const mobilePerformanceEventName = pgEnum(
  "mobile_performance_event_name",
  [
    "api_request",
    "api_server_timing",
    "feed_disk_cache_clear",
    "feed_disk_cache_hit",
    "feed_disk_cache_miss",
    "feed_disk_cache_restore",
    "feed_disk_cache_write",
    "feed_disk_restore",
    "feed_load",
    "feed_media_preheat",
    "feed_refresh_failed",
    "media_cache_summary",
    "media_file_cache_failed",
    "media_file_cache_hit",
    "media_file_cache_skip",
    "media_file_cache_write",
    "hls_asset_download_failed",
    "hls_asset_download_finished",
    "hls_asset_download_start",
    "hls_asset_package_hit",
    "media_qoe_config",
    "image_derivatives_prepared",
    "image_derivative_upload_failed",
    "background_upload_resume",
    "silent_push_prewarm",
    "story_open",
    "story_open_warm",
    "story_stack_cache_clear",
    "story_stack_cache_hit",
    "story_stack_cache_miss",
    "story_stack_disk_cache_hit",
    "story_stack_disk_cache_miss",
    "story_stack_disk_cache_write",
    "story_stack_disk_restore",
    "story_stack_display_cache_hit",
    "story_stack_fetch_join",
    "story_stack_network",
    "story_stack_prefetch_end",
    "story_stack_prefetch_start",
    "video_disk_cache_hit",
    "video_dismissed",
    "video_ended",
    "video_player_pool_hit",
    "video_player_pool_wait",
    "video_player_prepared",
    "video_player_staged",
    "video_preroll_reused",
    "video_prerolled",
    "video_retry",
    "video_recovered",
    "video_startup",
    "video_upload_failed",
    "video_upload_phase",
    "video_upload_retry",
    "video_upload_succeeded",
    "video_first_frame",
    "video_item_ready",
    "video_stalled",
    "video_terminal_failure",
    "video_access_log",
    "video_quality_ramp",
  ],
)
export const feedEventKind = pgEnum("feed_event_kind", [
  "impression",
  "completion",
  "skip",
  "hide",
  "rewatch",
])
export const safetyReportTargetKind = pgEnum("safety_report_target_kind", [
  "story",
  "user",
  "interaction",
])
export const safetyReportReason = pgEnum("safety_report_reason", [
  "spam",
  "harassment",
  "hate",
  "sexual_content",
  "violence",
  "self_harm",
  "illegal_goods",
  "impersonation",
  "intellectual_property",
  "other",
])
export const safetyReportStatus = pgEnum("safety_report_status", [
  "pending",
  "reviewed",
  "actioned",
  "dismissed",
])
export const moderationCheckTargetKind = pgEnum("moderation_check_target_kind", [
  "story",
  "interaction",
  "avatar",
  "user_profile",
])
export const moderationAction = pgEnum("moderation_action", [
  "approve",
  "hold",
  "reject",
])
export const mentionType = pgEnum("mention_type", ["tag", "text", "detected"])
export const campaignStatus = pgEnum("campaign_status", [
  "draft",
  "active",
  "paused",
  "closed",
])
export const payoutSource = pgEnum("payout_source", [
  "brand_match",
  "ad_share",
  "manual_adjustment",
])
export const payoutStatus = pgEnum("payout_status", [
  "pending",
  "approved",
  "paid",
  "reversed",
])
export const userOnboardingIntent = pgEnum("user_onboarding_intent", [
  "explore",
  "create",
  "both",
])
export const creatorStatus = pgEnum("creator_status", [
  "inactive",
  "active",
  "suspended",
])
export const authSessionKind = pgEnum("auth_session_kind", ["web", "mobile"])
export const advertiserAccountStatus = pgEnum("advertiser_account_status", [
  "active",
  "paused",
  "suspended",
])
export const advertiserMemberRole = pgEnum("advertiser_member_role", [
  "owner",
  "admin",
  "viewer",
])
export const advertiserWalletTransactionType = pgEnum(
  "advertiser_wallet_transaction_type",
  ["funding", "reserve", "capture", "release", "refund", "adjustment"],
)
export const advertiserWalletTransactionStatus = pgEnum(
  "advertiser_wallet_transaction_status",
  ["pending", "posted", "failed", "void"],
)
export const brandFundingProfileStatus = pgEnum(
  "brand_funding_profile_status",
  ["draft", "active", "paused"],
)
export const brandFundingTargetKind = pgEnum("brand_funding_target_kind", [
  "brand_name",
  "handle",
  "keyword",
  "hashtag",
  "domain",
  "product",
  "exclusion",
])
export const brandMatchEventStatus = pgEnum("brand_match_event_status", [
  "pending",
  "qualified",
  "rejected",
  "charged",
  "paid",
])
export const dailyCampaignStatus = pgEnum("daily_campaign_status", [
  "draft",
  "pending_review",
  "active",
  "paused",
  "completed",
  "rejected",
])
export const dailySessionStatus = pgEnum("daily_session_status", [
  "started",
  "paused",
  "completed",
  "abandoned",
])
export const dailyAdViewStatus = pgEnum("daily_ad_view_status", [
  "pending",
  "started",
  "completed",
  "skipped",
])
export const dailyPoolStatus = pgEnum("daily_pool_status", [
  "open",
  "drawing",
  "drawn",
  "cancelled",
])
export const dailyEntryStatus = pgEnum("daily_entry_status", [
  "eligible",
  "held",
  "void",
])
export const dailyWinnerStatus = pgEnum("daily_winner_status", [
  "pending",
  "approved",
  "paid",
  "held",
  "void",
])

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    authProvider: text("auth_provider").notNull().default("credentials"),
    authUserId: text("auth_user_id"),
    email: text("email").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    passwordHash: text("password_hash").notNull(),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    handle: text("handle"),
    displayName: text("display_name"),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    avatarAssetId: text("avatar_asset_id").references(
      (): AnyPgColumn => mediaAssets.id,
    ),
    avatarSourceUrl: text("avatar_source_url"),
    avatarSourceStorageKey: text("avatar_source_storage_key"),
    avatarSourceContentType: text("avatar_source_content_type"),
    avatarSourceByteSize: integer("avatar_source_byte_size"),
    onboardingIntent: userOnboardingIntent("onboarding_intent")
      .notNull()
      .default("explore"),
    creatorStatus: creatorStatus("creator_status")
      .notNull()
      .default("inactive"),
    isCreatorMode: boolean("is_creator_mode").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_handle_idx").on(table.handle),
    uniqueIndex("users_email_idx").on(table.email),
    uniqueIndex("users_auth_user_id_idx").on(table.authUserId),
  ],
)

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: authSessionKind("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("auth_sessions_user_id_idx").on(table.userId, table.createdAt),
    uniqueIndex("auth_sessions_token_hash_idx").on(table.tokenHash),
    index("auth_sessions_active_idx").on(
      table.userId,
      table.expiresAt,
      table.revokedAt,
    ),
  ],
)

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    purpose: mediaAssetPurpose("purpose").notNull(),
    assetKind: storyAssetKind("asset_kind").notNull(),
    storageProvider: mediaStorageProvider("storage_provider").notNull(),
    storageKey: text("storage_key").notNull(),
    mediaUrl: text("media_url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    placeholderUrl: text("placeholder_url"),
    originalMediaUrl: text("original_media_url"),
    originalThumbnailUrl: text("original_thumbnail_url"),
    originalStorageProvider: mediaStorageProvider("original_storage_provider"),
    originalStorageKey: text("original_storage_key"),
    originalContentType: text("original_content_type"),
    originalByteSize: integer("original_byte_size"),
    originalChecksum: text("original_checksum"),
    originalWidth: integer("original_width"),
    originalHeight: integer("original_height"),
    originalDurationMs: integer("original_duration_ms"),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    checksum: text("checksum").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    processingStatus: mediaAssetStatus("processing_status")
      .notNull()
      .default("processing"),
    scanStatus: mediaScanStatus("scan_status").notNull().default("pending"),
    scanReason: text("scan_reason"),
    providerStatus: text("provider_status"),
    providerPctComplete: integer("provider_pct_complete"),
    providerError: text("provider_error"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("media_assets_provider_key_idx").on(
      table.storageProvider,
      table.storageKey,
    ),
    index("media_assets_original_provider_key_idx").on(
      table.originalStorageProvider,
      table.originalStorageKey,
    ),
    index("media_assets_owner_idx").on(table.ownerUserId, table.createdAt),
    index("media_assets_processing_idx").on(
      table.processingStatus,
      table.updatedAt,
    ),
    index("media_assets_scan_idx").on(table.scanStatus, table.updatedAt),
  ],
)

export const mediaAuditEvents = pgTable(
  "media_audit_events",
  {
    id: text("id").primaryKey(),
    mediaAssetId: text("media_asset_id")
      .notNull()
      .references(() => mediaAssets.id),
    actorUserId: text("actor_user_id").references((): AnyPgColumn => users.id),
    eventType: text("event_type").notNull(),
    message: text("message"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("media_audit_events_asset_idx").on(table.mediaAssetId, table.createdAt),
    index("media_audit_events_actor_idx").on(table.actorUserId, table.createdAt),
  ],
)

export const moderationChecks = pgTable(
  "moderation_checks",
  {
    id: text("id").primaryKey(),
    targetKind: moderationCheckTargetKind("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    actorUserId: text("actor_user_id").references((): AnyPgColumn => users.id),
    mediaAssetId: text("media_asset_id").references(() => mediaAssets.id),
    provider: text("provider").notNull(),
    action: moderationAction("action").notNull(),
    reason: text("reason"),
    categories: text("categories").notNull().default("[]"),
    rawResult: text("raw_result"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("moderation_checks_target_idx").on(
      table.targetKind,
      table.targetId,
      table.createdAt,
    ),
    index("moderation_checks_action_idx").on(table.action, table.createdAt),
    index("moderation_checks_actor_idx").on(table.actorUserId, table.createdAt),
    index("moderation_checks_media_asset_idx").on(
      table.mediaAssetId,
      table.createdAt,
    ),
  ],
)

export const authRateLimits = pgTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    codeHash: text("code_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("email_verification_tokens_token_hash_idx").on(table.tokenHash),
    index("email_verification_tokens_code_hash_idx").on(table.codeHash),
    index("email_verification_tokens_user_id_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
)

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_token_hash_idx").on(table.tokenHash),
    index("password_reset_tokens_user_id_idx").on(table.userId, table.createdAt),
  ],
)

export const creatorProfiles = pgTable("creator_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  category: text("category"),
  creatorBio: text("creator_bio"),
  isPublic: boolean("is_public").notNull().default(true),
  analyticsEnabled: boolean("analytics_enabled").notNull().default(true),
  monetizationEnabled: boolean("monetization_enabled").notNull().default(false),
  stripeConnectedAccountId: text("stripe_connected_account_id"),
  stripePayoutsEnabled: boolean("stripe_payouts_enabled")
    .notNull()
    .default(false),
  stripeOnboardingComplete: boolean("stripe_onboarding_complete")
    .notNull()
    .default(false),
  stripeRequirementsStatus: text("stripe_requirements_status"),
  stripeRequirementsDue: text("stripe_requirements_due"),
  stripeConnectedAt: timestamp("stripe_connected_at", { withTimezone: true }),
  stripeUpdatedAt: timestamp("stripe_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("creator_profiles_stripe_account_idx").on(
    table.stripeConnectedAccountId,
  ),
])

export const follows = pgTable(
  "follows",
  {
    followerId: text("follower_id")
      .notNull()
      .references(() => users.id),
    followeeId: text("followee_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "follows_pkey",
      columns: [table.followerId, table.followeeId],
    }),
    index("follows_follower_id_idx").on(table.followerId, table.createdAt),
    index("follows_followee_id_idx").on(table.followeeId, table.createdAt),
  ],
)

export const mobileFeedSnapshots = pgTable(
  "mobile_feed_snapshots",
  {
    viewerId: text("viewer_id")
      .primaryKey()
      .references(() => users.id),
    payload: jsonb("payload").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("mobile_feed_snapshots_expires_idx").on(table.expiresAt),
    index("mobile_feed_snapshots_updated_idx").on(table.updatedAt),
  ],
)

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id),
    type: notificationType("type").notNull(),
    entityId: text("entity_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("notifications_user_type_entity_idx").on(
      table.userId,
      table.type,
      table.entityId,
    ),
    index("notifications_user_created_idx").on(table.userId, table.createdAt),
    index("notifications_unread_idx").on(
      table.userId,
      table.readAt,
      table.createdAt,
    ),
    index("notifications_actor_idx").on(table.actorUserId, table.createdAt),
  ],
)

export const userNotificationPreferences = pgTable(
  "user_notification_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    type: userNotificationPreferenceType("type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "user_notification_preferences_pkey",
      columns: [table.userId, table.type],
    }),
    index("user_notification_preferences_user_idx").on(
      table.userId,
      table.updatedAt,
    ),
  ],
)

export const userBlocks = pgTable(
  "user_blocks",
  {
    blockerId: text("blocker_id")
      .notNull()
      .references(() => users.id),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "user_blocks_pkey",
      columns: [table.blockerId, table.blockedId],
    }),
    index("user_blocks_blocker_idx").on(table.blockerId, table.createdAt),
    index("user_blocks_blocked_idx").on(table.blockedId, table.createdAt),
  ],
)

export const mobilePushTokens = pgTable(
  "mobile_push_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    expoPushToken: text("expo_push_token").notNull(),
    apnsDeviceToken: text("apns_device_token"),
    pushProvider: text("push_provider").notNull().default("expo"),
    apnsEnvironment: text("apns_environment"),
    platform: text("platform"),
    enabled: boolean("enabled").notNull().default(true),
    lastRegisteredAt: timestamp("last_registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("mobile_push_tokens_user_idx").on(table.userId),
    uniqueIndex("mobile_push_tokens_token_idx").on(table.expoPushToken),
    uniqueIndex("mobile_push_tokens_apns_token_idx").on(table.apnsDeviceToken),
  ],
)

export const creatorNotificationPreferences = pgTable(
  "creator_notification_preferences",
  {
    subscriberId: text("subscriber_id")
      .notNull()
      .references(() => users.id),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "creator_notification_preferences_pkey",
      columns: [table.subscriberId, table.creatorId],
    }),
    index("creator_notifications_subscriber_idx").on(
      table.subscriberId,
      table.updatedAt,
    ),
    index("creator_notifications_creator_idx").on(
      table.creatorId,
      table.updatedAt,
    ),
  ],
)

export const stories = pgTable(
  "stories",
  {
    id: text("id").primaryKey(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id),
    assetKind: storyAssetKind("asset_kind").notNull(),
    mediaUrl: text("media_url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    placeholderUrl: text("placeholder_url"),
    storageProvider: text("storage_provider"),
    storageKey: text("storage_key"),
    originalMediaUrl: text("original_media_url"),
    originalThumbnailUrl: text("original_thumbnail_url"),
    originalStorageProvider: text("original_storage_provider"),
    originalStorageKey: text("original_storage_key"),
    originalContentType: text("original_content_type"),
    originalByteSize: integer("original_byte_size"),
    originalChecksum: text("original_checksum"),
    originalWidth: integer("original_width"),
    originalHeight: integer("original_height"),
    originalDurationMs: integer("original_duration_ms"),
    contentType: text("content_type"),
    byteSize: integer("byte_size"),
    checksum: text("checksum"),
    mediaAssetId: text("media_asset_id")
      .notNull()
      .references(() => mediaAssets.id),
    width: integer("width"),
    height: integer("height"),
    processingStatus: text("processing_status").notNull().default("ready"),
    moderationStatus: text("moderation_status").notNull().default("approved"),
    moderationReason: text("moderation_reason"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
    caption: text("caption"),
    durationMs: integer("duration_ms"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: storyStatus("status").notNull().default("processing"),
    brandSignalScore: numeric("brand_signal_score", {
      precision: 5,
      scale: 2,
    }).default("0"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("stories_storage_key_idx").on(table.storageKey),
    index("stories_original_storage_key_idx").on(table.originalStorageKey),
    index("stories_moderation_status_idx").on(table.moderationStatus),
    index("stories_live_feed_idx").on(
      table.status,
      table.moderationStatus,
      table.expiresAt,
      table.createdAt,
    ),
    index("stories_creator_live_idx").on(
      table.creatorId,
      table.status,
      table.moderationStatus,
      table.expiresAt,
      table.createdAt,
    ),
    index("stories_processing_idx").on(
      table.storageProvider,
      table.processingStatus,
      table.status,
      table.moderationStatus,
      table.expiresAt,
      table.createdAt,
    ),
    index("stories_cloudflare_uid_idx").on(
      table.storageProvider,
      table.storageKey,
      table.expiresAt,
    ),
  ],
)

export const storyPublishJobs = pgTable(
  "story_publish_jobs",
  {
    storyId: text("story_id")
      .primaryKey()
      .references(() => stories.id, { onDelete: "cascade" }),
    workflowRunId: text("workflow_run_id"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    earningsCompletedAt: timestamp("earnings_completed_at", {
      withTimezone: true,
    }),
    fanoutCompletedAt: timestamp("fanout_completed_at", {
      withTimezone: true,
    }),
    notificationClaimedAt: timestamp("notification_claimed_at", {
      withTimezone: true,
    }),
    notificationCompletedAt: timestamp("notification_completed_at", {
      withTimezone: true,
    }),
    snapshotInvalidatedAt: timestamp("snapshot_invalidated_at", {
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("story_publish_jobs_status_idx").on(
      table.status,
      table.updatedAt,
    ),
    uniqueIndex("story_publish_jobs_run_idx").on(table.workflowRunId),
  ],
)

export const mediaUploadSessions = pgTable(
  "media_upload_sessions",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    purpose: mediaAssetPurpose("purpose").notNull().default("story"),
    assetKind: storyAssetKind("asset_kind").notNull(),
    storageProvider: mediaStorageProvider("storage_provider").notNull(),
    storageKey: text("storage_key").notNull(),
    clientUploadId: text("client_upload_id"),
    uploadUrl: text("upload_url").notNull(),
    uploadProtocol: text("upload_protocol").notNull(),
    expectedContentType: text("expected_content_type"),
    expectedByteSize: integer("expected_byte_size"),
    maxDurationSeconds: integer("max_duration_seconds"),
    status: text("status").notNull().default("prepared"),
    providerStatus: text("provider_status"),
    providerPctComplete: integer("provider_pct_complete"),
    providerError: text("provider_error"),
    providerPayload: jsonb("provider_payload"),
    providerEventAt: timestamp("provider_event_at", { withTimezone: true }),
    completedMediaAssetId: text("completed_media_asset_id").references(
      () => mediaAssets.id,
      { onDelete: "set null" },
    ),
    completedStoryId: text("completed_story_id").references(() => stories.id, {
      onDelete: "set null",
    }),
    completionClaimedAt: timestamp("completion_claimed_at", {
      withTimezone: true,
    }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("media_upload_sessions_provider_key_uidx").on(
      table.storageProvider,
      table.storageKey,
    ),
    uniqueIndex("media_upload_sessions_completed_story_uidx").on(
      table.completedStoryId,
    ),
    uniqueIndex("media_upload_sessions_completed_asset_uidx").on(
      table.completedMediaAssetId,
    ),
    uniqueIndex("media_upload_sessions_owner_client_uidx").on(
      table.ownerUserId,
      table.clientUploadId,
    ),
    index("media_upload_sessions_owner_status_idx").on(
      table.ownerUserId,
      table.status,
      table.expiresAt,
    ),
    index("media_upload_sessions_provider_event_idx").on(
      table.storageProvider,
      table.providerEventAt,
    ),
    index("media_upload_sessions_cleanup_expiry_idx").on(
      table.status,
      table.expiresAt,
    ),
    index("media_upload_sessions_cleanup_consumed_idx").on(
      table.status,
      table.consumedAt,
    ),
  ],
)

export const storyMentions = pgTable(
  "story_mentions",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id),
    brandSlug: text("brand_slug").notNull(),
    mentionType: mentionType("mention_type").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 2 }).default("0"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("story_mentions_story_id_idx").on(table.storyId, table.createdAt),
  ],
)

export const storyElements = pgTable(
  "story_elements",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id),
    kind: storyElementKind("kind").notNull(),
    label: text("label").notNull(),
    href: text("href"),
    sourceInteractionId: text("source_interaction_id").references(
      (): AnyPgColumn => storyInteractions.id,
    ),
    sourceActorName: text("source_actor_name"),
    sourceActorHandle: text("source_actor_handle"),
    sourceActorAvatarUrl: text("source_actor_avatar_url"),
    positionX: numeric("position_x", { precision: 5, scale: 2 }).default("50"),
    positionY: numeric("position_y", { precision: 5, scale: 2 }).default("74"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("story_elements_story_id_idx").on(table.storyId, table.createdAt),
    index("story_elements_source_interaction_idx").on(table.sourceInteractionId),
  ],
)

export const feedImpressions = pgTable(
  "feed_impressions",
  {
    id: text("id").primaryKey(),
    viewerId: text("viewer_id")
      .notNull()
      .references(() => users.id),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id),
    score: numeric("score", { precision: 8, scale: 4 }).notNull(),
    rank: integer("rank").notNull(),
    completed: boolean("completed").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
    viewedMs: integer("viewed_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("feed_impressions_story_viewer_created_idx").on(
      table.storyId,
      table.viewerId,
      table.createdAt,
    ),
  ],
)

export const feedEvents = pgTable(
  "feed_events",
  {
    id: text("id").primaryKey(),
    viewerId: text("viewer_id")
      .notNull()
      .references(() => users.id),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id),
    kind: feedEventKind("kind").notNull(),
    viewedMs: integer("viewed_ms"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("feed_events_viewer_created_idx").on(table.viewerId, table.createdAt),
    index("feed_events_story_created_idx").on(table.storyId, table.createdAt),
    index("feed_events_creator_kind_created_idx").on(
      table.creatorId,
      table.kind,
      table.createdAt,
    ),
  ],
)

export const storyInteractions = pgTable(
  "story_interactions",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    kind: storyInteractionKind("kind").notNull(),
    body: text("body"),
    reaction: text("reaction"),
    mediaUrl: text("media_url"),
    mediaThumbnailUrl: text("media_thumbnail_url"),
    mediaAssetKind: storyAssetKind("media_asset_kind"),
    mediaAssetId: text("media_asset_id").references(() => mediaAssets.id),
    moderationStatus: text("moderation_status").notNull().default("approved"),
    moderationReason: text("moderation_reason"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("story_interactions_story_id_idx").on(table.storyId, table.createdAt),
    index("story_interactions_creator_id_idx").on(
      table.creatorId,
      table.createdAt,
    ),
    index("story_interactions_actor_id_idx").on(table.actorId, table.createdAt),
    index("story_interactions_kind_idx").on(table.kind, table.createdAt),
    index("story_interactions_moderation_idx").on(
      table.moderationStatus,
      table.createdAt,
    ),
  ],
)

export const mobilePerformanceEvents = pgTable(
  "mobile_performance_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    name: mobilePerformanceEventName("name").notNull(),
    durationMs: integer("duration_ms"),
    metadata: jsonb("metadata").notNull().default({}),
    clientCreatedAt: timestamp("client_created_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("mobile_performance_events_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("mobile_performance_events_name_created_idx").on(
      table.name,
      table.createdAt,
    ),
  ],
)

export const safetyReports = pgTable(
  "safety_reports",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id),
    targetKind: safetyReportTargetKind("target_kind").notNull(),
    targetUserId: text("target_user_id").references(() => users.id),
    targetStoryId: text("target_story_id").references(() => stories.id),
    targetInteractionId: text("target_interaction_id").references(
      () => storyInteractions.id,
    ),
    reason: safetyReportReason("reason").notNull(),
    details: text("details"),
    status: safetyReportStatus("status").notNull().default("pending"),
    resolutionNote: text("resolution_note"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("safety_reports_status_idx").on(table.status, table.createdAt),
    index("safety_reports_reporter_idx").on(table.reporterId, table.createdAt),
    index("safety_reports_target_user_idx").on(
      table.targetUserId,
      table.createdAt,
    ),
    index("safety_reports_target_story_idx").on(
      table.targetStoryId,
      table.createdAt,
    ),
    index("safety_reports_target_interaction_idx").on(
      table.targetInteractionId,
      table.createdAt,
    ),
    uniqueIndex("safety_reports_story_once_idx").on(
      table.targetKind,
      table.reporterId,
      table.targetStoryId,
    ),
    uniqueIndex("safety_reports_user_once_idx").on(
      table.targetKind,
      table.reporterId,
      table.targetUserId,
    ),
    uniqueIndex("safety_reports_interaction_once_idx").on(
      table.targetKind,
      table.reporterId,
      table.targetInteractionId,
    ),
  ],
)

export const creatorScores = pgTable("creator_scores", {
  creatorId: text("creator_id")
    .primaryKey()
    .references(() => users.id),
  freshnessScore: numeric("freshness_score", { precision: 6, scale: 3 })
    .notNull()
    .default("0"),
  affinityScore: numeric("affinity_score", { precision: 6, scale: 3 })
    .notNull()
    .default("0"),
  qualityScore: numeric("quality_score", { precision: 6, scale: 3 })
    .notNull()
    .default("0"),
  monetizationScore: numeric("monetization_score", {
    precision: 6,
    scale: 3,
  })
    .notNull()
    .default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const advertiserAccounts = pgTable(
  "advertiser_accounts",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    websiteUrl: text("website_url"),
    billingEmail: text("billing_email").notNull(),
    status: advertiserAccountStatus("status").notNull().default("active"),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("advertiser_accounts_owner_user_id_idx").on(table.ownerUserId),
    uniqueIndex("advertiser_accounts_stripe_customer_id_idx").on(
      table.stripeCustomerId,
    ),
  ],
)

export const advertiserMembers = pgTable(
  "advertiser_members",
  {
    advertiserAccountId: text("advertiser_account_id")
      .notNull()
      .references(() => advertiserAccounts.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: advertiserMemberRole("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "advertiser_members_pkey",
      columns: [table.advertiserAccountId, table.userId],
    }),
    index("advertiser_members_user_id_idx").on(table.userId),
  ],
)

export const advertiserWalletTransactions = pgTable(
  "advertiser_wallet_transactions",
  {
    id: text("id").primaryKey(),
    advertiserAccountId: text("advertiser_account_id")
      .notNull()
      .references(() => advertiserAccounts.id),
    type: advertiserWalletTransactionType("type").notNull(),
    status: advertiserWalletTransactionStatus("status")
      .notNull()
      .default("pending"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    description: text("description"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (table) => [
    index("advertiser_wallet_account_idx").on(
      table.advertiserAccountId,
      table.createdAt,
    ),
    uniqueIndex("advertiser_wallet_stripe_session_idx").on(
      table.stripeCheckoutSessionId,
    ),
    uniqueIndex("advertiser_wallet_stripe_payment_intent_idx").on(
      table.stripePaymentIntentId,
    ),
  ],
)

export const advertiserPaymentMethods = pgTable(
  "advertiser_payment_methods",
  {
    id: text("id").primaryKey(),
    advertiserAccountId: text("advertiser_account_id")
      .notNull()
      .references(() => advertiserAccounts.id),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripePaymentMethodId: text("stripe_payment_method_id").notNull(),
    type: text("type").notNull(),
    brand: text("brand"),
    last4: text("last4"),
    expMonth: integer("exp_month"),
    expYear: integer("exp_year"),
    billingName: text("billing_name"),
    billingEmail: text("billing_email"),
    status: text("status").notNull().default("active"),
    isDefault: boolean("is_default").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("advertiser_payment_methods_account_idx").on(
      table.advertiserAccountId,
      table.createdAt,
    ),
    uniqueIndex("advertiser_payment_methods_stripe_pm_idx").on(
      table.stripePaymentMethodId,
    ),
  ],
)

export const brandFundingProfiles = pgTable(
  "brand_funding_profiles",
  {
    id: text("id").primaryKey(),
    advertiserAccountId: text("advertiser_account_id")
      .notNull()
      .references(() => advertiserAccounts.id),
    status: brandFundingProfileStatus("status").notNull().default("draft"),
    displayName: text("display_name").notNull(),
    approvalMode: text("approval_mode").notNull().default("auto"),
    payoutAmountCents: integer("payout_amount_cents"),
    dailyCapCents: integer("daily_cap_cents"),
    monthlyCapCents: integer("monthly_cap_cents"),
    allowedCategories: text("allowed_categories"),
    blockedCategories: text("blocked_categories"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("brand_funding_profiles_account_idx").on(
      table.advertiserAccountId,
      table.createdAt,
    ),
  ],
)

export const brandFundingTargets = pgTable(
  "brand_funding_targets",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => brandFundingProfiles.id),
    kind: brandFundingTargetKind("kind").notNull(),
    value: text("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("brand_funding_targets_profile_idx").on(table.profileId),
    uniqueIndex("brand_funding_targets_unique_idx").on(
      table.profileId,
      table.kind,
      table.value,
    ),
  ],
)

export const brandMatchEvents = pgTable(
  "brand_match_events",
  {
    id: text("id").primaryKey(),
    advertiserAccountId: text("advertiser_account_id")
      .notNull()
      .references(() => advertiserAccounts.id),
    fundingProfileId: text("funding_profile_id")
      .notNull()
      .references(() => brandFundingProfiles.id),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id),
    matchedTargetId: text("matched_target_id").references(
      () => brandFundingTargets.id,
    ),
    status: brandMatchEventStatus("status").notNull().default("pending"),
    confidence: numeric("confidence", { precision: 5, scale: 2 }).default("0"),
    systemPricedAmountCents: integer("system_priced_amount_cents"),
    walletTransactionId: text("wallet_transaction_id").references(
      () => advertiserWalletTransactions.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("brand_match_events_account_idx").on(
      table.advertiserAccountId,
      table.createdAt,
    ),
    index("brand_match_events_story_idx").on(table.storyId),
    index("brand_match_events_creator_idx").on(table.creatorId, table.createdAt),
    uniqueIndex("brand_match_events_story_profile_idx").on(
      table.storyId,
      table.fundingProfileId,
    ),
  ],
)

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  brandSlug: text("brand_slug").notNull(),
  name: text("name").notNull(),
  status: campaignStatus("status").notNull().default("draft"),
  payoutModel: text("payout_model").notNull(),
  budgetCents: integer("budget_cents").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const storyCampaignMatches = pgTable("story_campaign_matches", {
  id: text("id").primaryKey(),
  storyId: text("story_id")
    .notNull()
    .references(() => stories.id),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => campaigns.id),
  matchedBy: text("matched_by").notNull(),
  estimatedPayoutCents: integer("estimated_payout_cents").notNull().default(0),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const earningsLedger = pgTable("earnings_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  storyId: text("story_id").references(() => stories.id),
  source: payoutSource("source").notNull(),
  sourceId: text("source_id").notNull(),
  status: payoutStatus("status").notNull().default("pending"),
  amountCents: integer("amount_cents").notNull(),
  availableAt: timestamp("available_at", { withTimezone: true }),
  stripeTransferId: text("stripe_transfer_id"),
  stripeTransferStatus: text("stripe_transfer_status"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("earnings_ledger_user_status_idx").on(table.userId, table.status),
  index("earnings_ledger_story_idx").on(table.storyId),
  uniqueIndex("earnings_ledger_source_user_idx").on(
    table.source,
    table.sourceId,
    table.userId,
  ),
  uniqueIndex("earnings_ledger_stripe_transfer_idx").on(table.stripeTransferId),
])

export const dailyCampaigns = pgTable(
  "daily_campaigns",
  {
    id: text("id").primaryKey(),
    advertiserAccountId: text("advertiser_account_id")
      .notNull()
      .references(() => advertiserAccounts.id),
    name: text("name").notNull(),
    brandName: text("brand_name").notNull(),
    status: dailyCampaignStatus("status").notNull().default("draft"),
    videoUrl: text("video_url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    destinationUrl: text("destination_url").notNull(),
    ctaText: text("cta_text").notNull().default("Learn more"),
    targetingSummary: text("targeting_summary"),
    dailyBudgetCents: integer("daily_budget_cents").notNull(),
    totalBudgetCents: integer("total_budget_cents"),
    maxDailyImpressions: integer("max_daily_impressions"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reviewNotes: text("review_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("daily_campaigns_account_idx").on(
      table.advertiserAccountId,
      table.createdAt,
    ),
    index("daily_campaigns_active_idx").on(
      table.status,
      table.startsAt,
      table.endsAt,
    ),
  ],
)

export const dailySessions = pgTable(
  "daily_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    poolDate: text("pool_date").notNull(),
    status: dailySessionStatus("status").notNull().default("started"),
    currentAdIndex: integer("current_ad_index").notNull().default(0),
    currentPositionMs: integer("current_position_ms").notNull().default(0),
    eligibilityAcceptedAt: timestamp("eligibility_accepted_at", {
      withTimezone: true,
    }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("daily_sessions_user_pool_date_idx").on(
      table.userId,
      table.poolDate,
    ),
    index("daily_sessions_pool_date_idx").on(table.poolDate, table.status),
  ],
)

export const dailySessionAds = pgTable(
  "daily_session_ads",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => dailySessions.id),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => dailyCampaigns.id),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("daily_session_ads_position_idx").on(
      table.sessionId,
      table.position,
    ),
    index("daily_session_ads_campaign_idx").on(table.campaignId),
  ],
)

export const dailyAdViews = pgTable(
  "daily_ad_views",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => dailySessions.id),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => dailyCampaigns.id),
    position: integer("position").notNull(),
    status: dailyAdViewStatus("status").notNull().default("pending"),
    lastPositionMs: integer("last_position_ms").notNull().default(0),
    durationMs: integer("duration_ms"),
    quartiles: jsonb("quartiles").notNull().default({}),
    clickCount: integer("click_count").notNull().default(0),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("daily_ad_views_position_idx").on(
      table.sessionId,
      table.position,
    ),
    index("daily_ad_views_campaign_created_idx").on(
      table.campaignId,
      table.createdAt,
    ),
  ],
)

export const dailyPools = pgTable(
  "daily_pools",
  {
    id: text("id").primaryKey(),
    poolDate: text("pool_date").notNull(),
    status: dailyPoolStatus("status").notNull().default("open"),
    fundsCents: integer("funds_cents").notNull().default(0),
    payoutPoolCents: integer("payout_pool_cents").notNull().default(0),
    winnerCount: integer("winner_count").notNull().default(5),
    periodStartsAt: timestamp("period_starts_at", {
      withTimezone: true,
    }).notNull(),
    periodEndsAt: timestamp("period_ends_at", { withTimezone: true }).notNull(),
    drawAt: timestamp("draw_at", { withTimezone: true }).notNull(),
    drawnAt: timestamp("drawn_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("daily_pools_pool_date_idx").on(table.poolDate),
    index("daily_pools_draw_idx").on(table.status, table.drawAt),
  ],
)

export const dailyPoolEntries = pgTable(
  "daily_pool_entries",
  {
    id: text("id").primaryKey(),
    poolDate: text("pool_date").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => dailySessions.id),
    status: dailyEntryStatus("status").notNull().default("eligible"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("daily_pool_entries_user_pool_date_idx").on(
      table.userId,
      table.poolDate,
    ),
    uniqueIndex("daily_pool_entries_session_idx").on(table.sessionId),
    index("daily_pool_entries_pool_date_idx").on(table.poolDate, table.status),
  ],
)

export const dailyWinners = pgTable(
  "daily_winners",
  {
    id: text("id").primaryKey(),
    poolId: text("pool_id")
      .notNull()
      .references(() => dailyPools.id),
    poolDate: text("pool_date").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    entryId: text("entry_id")
      .notNull()
      .references(() => dailyPoolEntries.id),
    amountCents: integer("amount_cents").notNull(),
    status: dailyWinnerStatus("status").notNull().default("approved"),
    earningsLedgerId: text("earnings_ledger_id").references(
      () => earningsLedger.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("daily_winners_pool_user_idx").on(table.poolId, table.userId),
    uniqueIndex("daily_winners_entry_idx").on(table.entryId),
    index("daily_winners_user_created_idx").on(table.userId, table.createdAt),
  ],
)
