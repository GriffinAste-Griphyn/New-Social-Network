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
  creatorId: string
  creator: string
  handle: string
  assetKind: SocialAssetKind
  mediaUrl: string
  thumbnailUrl: string | null
  title: string
  lastUploadedAt: string
  progressPercent: number
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
