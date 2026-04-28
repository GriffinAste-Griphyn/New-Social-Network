export type StoryPreview = {
  id: string
  creator: string
  handle: string
  imageUrl: string
  caption: string
  tags: string[]
  payoutHint: string
  engagement: string
}

export type CreatorPreview = {
  id: string
  name: string
  handle: string
  imageUrl: string
  storyStreak: string
  reason: string
  monetization: string
}

export const featuredStory: StoryPreview = {
  id: "story_1",
  creator: "Ari Bennett",
  handle: "@ari.collective",
  imageUrl:
    "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
  caption:
    "Sunset run, matcha stop, and a tagged windbreaker that the brand can claim against.",
  tags: ["Outdoor", "Style", "Brand match"],
  payoutHint: "Eligible for brand match + viewer pool",
  engagement: "83% completion",
}

export const recommendedCreators: CreatorPreview[] = [
  {
    id: "creator_1",
    name: "Mika Salazar",
    handle: "@mika.afterhours",
    imageUrl:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80",
    storyStreak: "5 live stories",
    reason: "Viewers who finish Ari's stories keep swiping here.",
    monetization: "High apparel affinity",
  },
  {
    id: "creator_2",
    name: "Jordan Ellis",
    handle: "@jordaneats",
    imageUrl:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80",
    storyStreak: "2 video stories",
    reason: "Strong rewatch rate on food + city clips.",
    monetization: "Tagged local restaurant partner",
  },
  {
    id: "creator_3",
    name: "Nia Okafor",
    handle: "@nia.moves",
    imageUrl:
      "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=400&q=80",
    storyStreak: "7 live stories",
    reason: "Workout viewers convert into high-return sessions.",
    monetization: "Fitness brand mentions trending",
  },
  {
    id: "creator_4",
    name: "Theo Park",
    handle: "@theopark.jpg",
    imageUrl:
      "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80",
    storyStreak: "1 image story",
    reason: "Fresh creator with unusual completion velocity.",
    monetization: "Open inventory for ad-share pool",
  },
]

export const architectureChoices = [
  {
    title: "Language",
    value: "TypeScript end to end",
    detail:
      "Use one language across app UI, route handlers, validation, and database tooling. Add Python later only for offline ranking experiments if the model work actually demands it.",
  },
  {
    title: "Frontend",
    value: "Next.js App Router + shadcn/ui",
    detail:
      "This gets you fast product iteration for the web app, creator studio, admin tools, and monetization surfaces with open-code components you can keep shaping.",
  },
  {
    title: "Backend",
    value: "Neon Postgres + Drizzle + route handlers",
    detail:
      "Start as a modular monolith. Keep feed, monetization, media metadata, and payouts in one codebase until usage makes extraction necessary.",
  },
  {
    title: "Infra",
    value: "Neon for Postgres, Cloudflare Stream for video, Stripe Connect for payouts",
    detail:
      "Neon handles the relational backend cleanly with Drizzle. Stream handles direct uploads, encoding, and playback. Stripe Connect is the right primitive for creator and brand payouts.",
  },
]

export const domainStreams = [
  {
    name: "Identity",
    items: [
      "Handle claim with uniqueness, reservation windows, and rename audit trail.",
      "Profiles without follower counts anywhere in the core product.",
      "Trust and safety flags separate from public creator state.",
    ],
  },
  {
    name: "Story graph",
    items: [
      "Stories are the only content type and always expire unless promoted into highlights later.",
      "Store image and video assets outside Postgres and keep media metadata in Postgres.",
      "Track completion, skips, hides, rewatches, tags, and brand mentions as event data.",
    ],
  },
  {
    name: "Feed and monetization",
    items: [
      "For You ranking starts with heuristics: freshness, completion, hide rate, topic affinity, and creator diversity.",
      "Brand match pipeline starts rules-first: explicit tags, handle mentions, and campaign category matches.",
      "Every eligible payout writes to one ledger so ad share and branded content settle through the same accounting path.",
    ],
  },
]

export const schemaHighlights = [
  "users",
  "follows",
  "stories",
  "story_mentions",
  "feed_impressions",
  "creator_scores",
  "campaigns",
  "story_campaign_matches",
  "earnings_ledger",
]

export const launchMilestones = [
  {
    title: "Phase 1",
    goal: "Claim handles, upload stories, watch the feed.",
  },
  {
    title: "Phase 2",
    goal: "Launch the first For You model with event logging and moderation gates.",
  },
  {
    title: "Phase 3",
    goal: "Turn on brand matching, creator earnings ledger, and Stripe Connect payouts.",
  },
  {
    title: "Phase 4",
    goal: "Add a native mobile client once the loop is proven and the ranking data is real.",
  },
]
