export type SocialAssetKind = "image" | "video"

export interface SocialSessionPreview {
  displayName: string
  handle: string
}

export interface SocialFollowingProfile {
  id: string
  name: string
  handle: string
  imageUrl: string
}

export interface SocialStoryCard {
  id: string
  creator: string
  handle: string
  assetKind: SocialAssetKind
  mediaUrl: string
  thumbnailUrl: string | null
  originalMediaUrl?: string | null
  originalThumbnailUrl?: string | null
  title: string
  processingStatus?: string
  textOverlays?: Array<{
    id: string
    label: string
    kind?: "text" | "link" | "quote_reply"
    href?: string | null
    sourceInteractionId?: string | null
    sourceActorName?: string | null
    sourceActorHandle?: string | null
    sourceActorAvatarUrl?: string | null
    positionX: number
    positionY: number
  }>
  durationSeconds?: number
  lastUploadedAt: string
  progressPercent: number
  timelineSegmentCount: number
}

export interface SocialDiscoverTile {
  id: string
  assetKind: SocialAssetKind
  imageUrl: string
  thumbnailUrl: string | null
  title: string
  subtitle?: string
}

export interface SocialAppHomeContract {
  session: SocialSessionPreview
  followingProfiles: SocialFollowingProfile[]
  followingStories: SocialStoryCard[]
  discoverTiles: SocialDiscoverTile[]
}
