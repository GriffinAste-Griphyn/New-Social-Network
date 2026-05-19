import Foundation

enum SocialAssetKind: String, Codable, Hashable {
    case image
    case video
}

struct MobileAccount: Codable, Equatable {
    let email: String
    var displayName: String
    var handle: String
    var avatarUrl: URL?
    let mobileToken: String
}

struct MobileAuthUser: Codable {
    let email: String
    let displayName: String?
    let handle: String?
    let avatarUrl: URL?
}

struct AuthResponse: Codable {
    let ok: Bool
    let user: MobileAuthUser
    let profileComplete: Bool
    let mobileToken: String
}

struct SignupResponse: Codable {
    let ok: Bool
    let pendingEmail: String
    let message: String?
}

struct BasicOkResponse: Codable {
    let ok: Bool
}

struct SessionPreview: Codable {
    let displayName: String
    let handle: String
}

struct FollowingProfile: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let handle: String
    let imageUrl: URL?
    let activeStoryId: String?
    let hasActiveStory: Bool?
}

struct StoryTextOverlay: Codable, Hashable, Identifiable {
    let id: String
    let label: String
    let positionX: Double
    let positionY: Double
    let kind: String?
    let href: URL?
}

struct StoryCard: Codable, Identifiable, Hashable {
    let id: String
    let creator: String
    let handle: String
    let assetKind: SocialAssetKind
    let mediaUrl: URL
    let thumbnailUrl: URL?
    let title: String
    let textOverlays: [StoryTextOverlay]?
    let durationSeconds: Double?
    let lastUploadedAt: String?
    let progressPercent: Double?
    let timelineSegmentCount: Int?
}

struct DiscoverTile: Codable, Identifiable, Hashable {
    let id: String
    let assetKind: SocialAssetKind?
    let imageUrl: URL?
    let thumbnailUrl: URL?
    let title: String
    let subtitle: String?
    let activeStoryId: String?
    let hasActiveStory: Bool?
}

struct SuggestedAccount: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let handle: String
    let imageUrl: URL?
    let storyStreak: String
    let reason: String
    let monetization: String
}

struct MyStorySummary: Codable, Hashable {
    struct Owner: Codable, Hashable {
        let id: String
        let name: String
        let handle: String
        let imageUrl: URL?
    }

    let owner: Owner
    let hasActiveStory: Bool
    let liveCount: Int
    let latestThumbnailUrl: URL?
    let latestAssetKind: SocialAssetKind?
    let latestTextOverlays: [StoryTextOverlay]?
    let expiresSoonLabel: String?
    let items: [StoryCard]
}

struct MobileFeedResponse: Codable {
    let ok: Bool
    let session: SessionPreview
    let followingProfiles: [FollowingProfile]
    let followingStories: [StoryCard]
    let followingTimelineStories: [StoryCard]?
    let discoverTiles: [DiscoverTile]
    let suggestedAccounts: [SuggestedAccount]
    let myStory: MyStorySummary
}

extension MobileFeedResponse {
    var verticalFollowingStories: [StoryCard] {
        followingTimelineStories ?? followingStories
    }
}

struct FollowStateResponse: Codable {
    let ok: Bool
    let followedCreatorIds: [String]
}

struct FollowProfilesResponse: Codable {
    let ok: Bool
    let followers: [FollowingProfile]
    let following: [FollowingProfile]
}

struct DiscoverSearchResponse: Codable {
    let ok: Bool
    let profiles: [FollowingProfile]
}

struct CreatorStatsResponse: Codable {
    struct Earnings: Codable {
        let totalCents: Int?
        let pendingCents: Int?
        let approvedCents: Int?
        let paidCents: Int?
        let reversedCents: Int?
        let availableCents: Int?
        let nextAvailableAt: String?
    }

    struct Stats: Codable {
        struct Story: Codable, Identifiable, Hashable {
            let id: String
            let assetKind: SocialAssetKind
            let mediaUrl: URL
            let thumbnailUrl: URL?
            let caption: String?
            let status: String
            let createdAt: String
            let expiresAt: String
            let views: Int
            let uniqueViewers: Int
            let completedViews: Int
            let completionRate: Int
            let averageViewedSeconds: Double
            let comments: Int
            let replies: Int
            let earningsCents: Int
            let pendingEarningsCents: Int
            let paidEarningsCents: Int
        }

        let followerCount: Int
        let followingCount: Int
        let totalStories: Int
        let liveStories: Int
        let expiredStories: Int
        let removedStories: Int
        let totalViews: Int
        let uniqueViewers: Int
        let completedViews: Int
        let completionRate: Int
        let averageViewedSeconds: Double
        let totalViewedSeconds: Int
        let comments: Int
        let replies: Int
        let earnings: Earnings
        let stories: [Story]
    }

    let ok: Bool
    let stats: Stats
}

struct StripeConnectStatusResponse: Codable {
    struct Status: Codable {
        let connected: Bool?
        let chargesEnabled: Bool?
        let payoutsEnabled: Bool?
        let onboardingUrl: URL?
        let dashboardUrl: URL?
        let requirementsDue: [String]?
    }

    let ok: Bool
    let status: Status?
    let earnings: CreatorStatsResponse.Earnings?
}

struct StoryStackResponse: Codable {
    let ok: Bool
    let story: StoryStack
}

struct StoryStack: Codable, Identifiable, Hashable {
    let id: String
    let creatorId: String
    let creator: String
    let handle: String
    let avatarUrl: URL?
    let items: [StoryStackItem]
}

struct StoryStackItem: Codable, Identifiable, Hashable {
    struct Stats: Codable, Hashable {
        let views: Int
        let uniqueViewers: Int
        let completedViews: Int
        let completionRate: Double
        let averageViewedSeconds: Double
        let comments: Int
        let replies: Int
        let earningsCents: Int
    }

    let id: String
    let assetKind: SocialAssetKind
    let mediaUrl: URL
    let thumbnailUrl: URL?
    let title: String
    let textOverlays: [StoryTextOverlay]?
    let postedAt: String
    let durationSeconds: Double?
    let captionVerticalPercent: Double?
    let stats: Stats?
}

struct StoryInteractionResponse: Codable {
    struct Asset: Codable {
        let assetKind: SocialAssetKind
        let mediaUrl: URL
        let thumbnailUrl: URL?
    }

    let ok: Bool
    let asset: Asset?
}

struct StoryInteractionInboxResponse: Codable {
    let ok: Bool
    let interactions: [StoryInteractionEvent]
    let sentInteractions: [SentStoryInteractionEvent]
}

struct StoryInteractionEvent: Codable, Identifiable, Hashable {
    struct Story: Codable, Hashable {
        let assetKind: SocialAssetKind
        let mediaUrl: URL
        let thumbnailUrl: URL?
    }

    struct Actor: Codable, Hashable {
        let id: String
        let name: String
        let handle: String
        let imageUrl: URL?
    }

    let id: String
    let storyId: String
    let creatorId: String
    let story: Story
    let actor: Actor
    let kind: String
    let body: String?
    let reaction: String?
    let mediaUrl: URL?
    let mediaThumbnailUrl: URL?
    let mediaAssetKind: SocialAssetKind?
    let createdAt: String
}

struct SentStoryInteractionEvent: Codable, Identifiable, Hashable {
    struct Target: Codable, Hashable {
        let id: String
        let name: String
        let handle: String
        let imageUrl: URL?
    }

    let id: String
    let storyId: String
    let creatorId: String
    let story: StoryInteractionEvent.Story
    let actor: StoryInteractionEvent.Actor
    let target: Target
    let kind: String
    let body: String?
    let reaction: String?
    let mediaUrl: URL?
    let mediaThumbnailUrl: URL?
    let mediaAssetKind: SocialAssetKind?
    let createdAt: String
}

struct StoryImpressionResponse: Codable {
    let ok: Bool
}

struct SafetyReportResponse: Codable {
    let ok: Bool
    let reportId: String
}

struct AvatarUploadResponse: Codable {
    let ok: Bool
    let user: MobileAuthUser
}

struct AvatarCrop: Codable, Equatable {
    let originX: Double
    let originY: Double
    let width: Double
    let height: Double
}

struct AvatarSourceResponse: Codable {
    let ok: Bool
    let sourceUrl: URL?
    let fallbackAvatarUrl: URL?
}

struct BlockedProfilesResponse: Codable {
    struct BlockedProfile: Codable, Identifiable, Hashable {
        let id: String
        let name: String?
        let handle: String?
        let imageUrl: URL?
    }

    let ok: Bool
    let blocked: [BlockedProfile]
}

struct StoryUploadResponse: Codable {
    struct Asset: Codable {
        let assetKind: SocialAssetKind
        let mediaUrl: URL
        let thumbnailUrl: URL?
    }

    let ok: Bool
    let storyId: String
    let asset: Asset
    let processingStatus: String?
    let moderationStatus: String?
    let moderationReason: String?
}

struct VideoUploadResponse: Codable {
    let ok: Bool
    let uid: String
    let uploadUrl: URL
    let uploadProtocol: String?
    let thumbnailPathname: String?
    let thumbnailUploadUrl: URL?
    let thumbnailClientToken: String?
    let thumbnailContentType: String?
    let maxThumbnailSizeBytes: Int64?
}

struct OriginalVideoUploadResponse: Codable {
    let ok: Bool
    let pathname: String
    let uploadUrl: URL
    let clientToken: String
    let contentType: String
    let maxSizeBytes: Int64
    let thumbnailPathname: String
    let thumbnailUploadUrl: URL
    let thumbnailClientToken: String
    let thumbnailContentType: String
    let maxThumbnailSizeBytes: Int64
}

struct OriginalVideoBlobUploadResult: Codable {
    let url: URL
    let downloadUrl: URL?
    let pathname: String
    let contentType: String?
    let contentDisposition: String?
    let etag: String?
}

struct StoryStatusResponse: Codable {
    struct Story: Codable {
        let id: String
        let status: String
        let processingStatus: String
        let isLive: Bool
    }

    let ok: Bool
    let story: Story
}

struct APIErrorEnvelope: Decodable {
    let error: String?
}
