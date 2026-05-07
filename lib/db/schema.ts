import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

export const storyAssetKind = pgEnum("story_asset_kind", ["image", "video"])
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
])
export const storyInteractionKind = pgEnum("story_interaction_kind", [
  "reply",
  "comment",
  "reaction",
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
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("email_verification_tokens_token_hash_idx").on(table.tokenHash),
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

export const stories = pgTable("stories", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id")
    .notNull()
    .references(() => users.id),
  assetKind: storyAssetKind("asset_kind").notNull(),
  mediaUrl: text("media_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
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
})

export const storyMentions = pgTable("story_mentions", {
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
})

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
    positionX: numeric("position_x", { precision: 5, scale: 2 }).default("50"),
    positionY: numeric("position_y", { precision: 5, scale: 2 }).default("74"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("story_elements_story_id_idx").on(table.storyId, table.createdAt),
  ],
)

export const feedImpressions = pgTable("feed_impressions", {
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
})

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
  source: payoutSource("source").notNull(),
  sourceId: text("source_id").notNull(),
  status: payoutStatus("status").notNull().default("pending"),
  amountCents: integer("amount_cents").notNull(),
  availableAt: timestamp("available_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})
