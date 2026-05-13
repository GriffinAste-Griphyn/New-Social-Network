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
}

struct StoryTextOverlay: Codable, Hashable, Identifiable {
    let id: String
    let label: String
    let positionX: Double
    let positionY: Double
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
    let assetKind: SocialAssetKind
    let imageUrl: URL
    let thumbnailUrl: URL?
    let title: String
    let subtitle: String?
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
    let discoverTiles: [DiscoverTile]
    let suggestedAccounts: [SuggestedAccount]
    let myStory: MyStorySummary
}

struct FollowStateResponse: Codable {
    let ok: Bool
    let followedCreatorIds: [String]
}

struct DiscoverSearchResponse: Codable {
    let ok: Bool
    let profiles: [FollowingProfile]
}

struct CreatorStatsResponse: Codable {
    struct Earnings: Codable {
        let availableCents: Int
        let pendingCents: Int
        let paidCents: Int
    }

    struct Stats: Codable {
        let earnings: Earnings
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
}

struct VideoUploadResponse: Codable {
    let ok: Bool
    let uid: String
    let uploadUrl: URL
    let uploadProtocol: String?
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
