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

struct MobilePerformanceEventUpload: Codable {
    let name: String
    let durationMs: Int?
    let metadata: [String: String]
    let clientCreatedAt: String
}

enum NotificationPreferenceType: String, Codable, CaseIterable, Identifiable {
    case creatorStories = "creator_stories"
    case replies
    case follows

    var id: String { rawValue }

    var title: String {
        switch self {
        case .creatorStories:
            "Story posts"
        case .replies:
            "Replies"
        case .follows:
            "New followers"
        }
    }

    var subtitle: String {
        switch self {
        case .creatorStories:
            "When creators you follow post a story"
        case .replies:
            "When someone replies to your stories"
        case .follows:
            "When someone follows your profile"
        }
    }

    var icon: String {
        switch self {
        case .creatorStories:
            "play.rectangle.on.rectangle"
        case .replies:
            "bubble.left.and.bubble.right"
        case .follows:
            "person.crop.circle.badge.plus"
        }
    }
}

struct NotificationPreference: Codable, Identifiable, Equatable {
    let type: NotificationPreferenceType
    var enabled: Bool

    var id: NotificationPreferenceType { type }
}

struct NotificationPreferencesResponse: Codable {
    let ok: Bool
    let preferences: [NotificationPreference]
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
    let sourceInteractionId: String?
    let sourceActorName: String?
    let sourceActorHandle: String?
    let sourceActorAvatarUrl: URL?
}

struct QuotedStoryReply: Identifiable, Hashable {
    let id: String
    let actorName: String
    let actorHandle: String
    let actorAvatarUrl: URL?
    let message: String
}

struct StoryCard: Codable, Identifiable, Hashable {
    let id: String
    let creator: String
    let handle: String
    let assetKind: SocialAssetKind
    let mediaUrl: URL
    let thumbnailUrl: URL?
    let title: String
    let processingStatus: String?
    let textOverlays: [StoryTextOverlay]?
    let durationSeconds: Double?
    let lastUploadedAt: String?
    let progressPercent: Double?
    let timelineSegmentCount: Int?
}

extension StoryCard {
    var isProcessingVideo: Bool {
        assetKind == .video && processingStatus != nil && processingStatus != "ready"
    }

    var isPlayableVideo: Bool {
        assetKind == .video && !isProcessingVideo
    }
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
            struct Comment: Codable, Identifiable, Hashable {
                struct Actor: Codable, Hashable {
                    let id: String
                    let name: String
                    let handle: String
                    let imageUrl: URL?
                }

                let id: String
                let storyId: String
                let actor: Actor
                let body: String?
                let mediaUrl: URL?
                let mediaThumbnailUrl: URL?
                let mediaAssetKind: SocialAssetKind?
                let createdAt: String
            }

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
            let commentItems: [Comment]

            private enum CodingKeys: String, CodingKey {
                case id
                case assetKind
                case mediaUrl
                case thumbnailUrl
                case caption
                case status
                case createdAt
                case expiresAt
                case views
                case uniqueViewers
                case completedViews
                case completionRate
                case averageViewedSeconds
                case comments
                case replies
                case earningsCents
                case pendingEarningsCents
                case paidEarningsCents
                case commentItems
            }

            init(from decoder: Decoder) throws {
                let container = try decoder.container(keyedBy: CodingKeys.self)

                id = try container.decode(String.self, forKey: .id)
                assetKind = try container.decode(SocialAssetKind.self, forKey: .assetKind)
                mediaUrl = try container.decode(URL.self, forKey: .mediaUrl)
                thumbnailUrl = try container.decodeIfPresent(URL.self, forKey: .thumbnailUrl)
                caption = try container.decodeIfPresent(String.self, forKey: .caption)
                status = try container.decode(String.self, forKey: .status)
                createdAt = try container.decode(String.self, forKey: .createdAt)
                expiresAt = try container.decode(String.self, forKey: .expiresAt)
                views = try container.decode(Int.self, forKey: .views)
                uniqueViewers = try container.decode(Int.self, forKey: .uniqueViewers)
                completedViews = try container.decode(Int.self, forKey: .completedViews)
                completionRate = try container.decode(Int.self, forKey: .completionRate)
                averageViewedSeconds = try container.decode(Double.self, forKey: .averageViewedSeconds)
                comments = try container.decode(Int.self, forKey: .comments)
                replies = try container.decode(Int.self, forKey: .replies)
                earningsCents = try container.decode(Int.self, forKey: .earningsCents)
                pendingEarningsCents = try container.decode(Int.self, forKey: .pendingEarningsCents)
                paidEarningsCents = try container.decode(Int.self, forKey: .paidEarningsCents)
                commentItems = try container.decodeIfPresent([Comment].self, forKey: .commentItems) ?? []
            }
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
    let processingStatus: String?
    let textOverlays: [StoryTextOverlay]?
    let postedAt: String
    let durationSeconds: Double?
    let captionVerticalPercent: Double?
    let stats: Stats?
}

extension StoryStackItem {
    var isProcessingVideo: Bool {
        assetKind == .video && processingStatus != nil && processingStatus != "ready"
    }

    var isPlayableVideo: Bool {
        assetKind == .video && !isProcessingVideo
    }
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
    let providerStatus: String?
    let providerError: String?
    let lastCheckedAt: String?
    let readyAt: String?
    let moderationStatus: String?
    let moderationReason: String?
    let textOverlays: [StoryTextOverlay]?
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

    private enum CodingKeys: String, CodingKey {
        case error
    }

    private struct NestedError: Decodable {
        let message: String?
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let message = try? container.decode(String.self, forKey: .error) {
            error = message
            return
        }

        error = try? container.decode(NestedError.self, forKey: .error).message
    }
}
