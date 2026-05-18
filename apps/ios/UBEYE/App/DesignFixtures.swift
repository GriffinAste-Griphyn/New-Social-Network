import SwiftUI

struct FixtureCreator: Identifiable, Hashable {
    let id: String
    let name: String
    let handle: String
    let imageUrl: URL?
    let initials: String
    let isFollowing: Bool
}

struct FixtureStory: Identifiable, Hashable {
    let id: String
    let creator: FixtureCreator
    let title: String
    let overlay: String
    let imageUrl: URL?
    let postedAt: String
    let views: String
    let uniqueViews: String
    let completion: String
    let completeViews: String
    let comments: String
    let replies: String
    let earnings: String
    let paid: String
}

enum DesignFixtures {
    static let accountName = "Avery Stone"
    static let accountHandle = "averystone"
    static let accountEmail = "creator@ubeye.ai"
    static let accountAvatar = url("https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=500&q=80")

    static let creators: [FixtureCreator] = [
        FixtureCreator(
            id: "creator-lena",
            name: "Lena Brooks",
            handle: "lenabrooks",
            imageUrl: url("https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=500&q=80"),
            initials: "LB",
            isFollowing: true
        ),
        FixtureCreator(
            id: "creator-miles",
            name: "Miles Carter",
            handle: "milescarter",
            imageUrl: url("https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=500&q=80"),
            initials: "MC",
            isFollowing: true
        ),
        FixtureCreator(
            id: "creator-nia",
            name: "Nia Flores",
            handle: "niaflores",
            imageUrl: url("https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=500&q=80"),
            initials: "NF",
            isFollowing: true
        ),
        FixtureCreator(
            id: "creator-jules",
            name: "Jules Park",
            handle: "julespark",
            imageUrl: url("https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80"),
            initials: "JP",
            isFollowing: false
        ),
    ]

    static let stories: [FixtureStory] = [
        FixtureStory(
            id: "story-lena",
            creator: creators[0],
            title: "Morning studio notes",
            overlay: "new drop today",
            imageUrl: url("https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=80"),
            postedAt: "May 13 at 8:30 AM",
            views: "18,400",
            uniqueViews: "14,200 unique",
            completion: "72%",
            completeViews: "10,800 complete",
            comments: "41",
            replies: "22",
            earnings: "$1,480.00",
            paid: "$820.00 paid"
        ),
        FixtureStory(
            id: "story-miles",
            creator: creators[1],
            title: "Behind the shoot",
            overlay: "location scout",
            imageUrl: url("https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1200&q=80"),
            postedAt: "May 13 at 7:20 AM",
            views: "21,500",
            uniqueViews: "16,300 unique",
            completion: "75%",
            completeViews: "12,300 complete",
            comments: "50",
            replies: "28",
            earnings: "$1,900.00",
            paid: "$940.00 paid"
        ),
        FixtureStory(
            id: "story-nia",
            creator: creators[2],
            title: "Coffee run Q&A",
            overlay: "ask me anything",
            imageUrl: url("https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1200&q=80"),
            postedAt: "May 13 at 6:10 AM",
            views: "24,600",
            uniqueViews: "18,400 unique",
            completion: "78%",
            completeViews: "13,800 complete",
            comments: "59",
            replies: "34",
            earnings: "$2,320.00",
            paid: "$1,060.00 paid"
        ),
    ]

    static let discoverImages: [URL?] = [
        stories[0].imageUrl,
        stories[1].imageUrl,
        stories[2].imageUrl,
        url("https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=1200&q=80"),
    ]

    static func url(_ value: String) -> URL? {
        URL(string: value)
    }
}

struct ExpoScreenHeader: View {
    let eyebrow: String?
    let title: String
    let subtitle: String?
    var avatarUrl: URL?
    var avatarName: String?
    var onBack: (() -> Void)?

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            if let onBack {
                Button(action: onBack) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .bold))
                        .frame(width: 38, height: 38)
                        .foregroundStyle(Color.ubeyeInk)
                        .background(.white, in: Circle())
                        .overlay(Circle().stroke(Color.ubeyeBorder, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }

            VStack(alignment: .leading, spacing: 2) {
                if let eyebrow {
                    Text(eyebrow.uppercased())
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.ubeyeMuted)
                }
                Text(title)
                    .font(.system(size: 28, weight: .bold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.82)
                if let subtitle {
                    Text(subtitle)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.ubeyeMuted)
                        .lineLimit(2)
                }
            }

            Spacer(minLength: 8)

            if let avatarUrl {
                RemoteAvatar(url: avatarUrl, size: 42, name: avatarName ?? title)
            }
        }
        .foregroundStyle(Color.ubeyeInk)
    }
}

struct ExpoSegmentedControl: View {
    let items: [String]
    @Binding var selected: String

    var body: some View {
        HStack(spacing: 0) {
            ForEach(items, id: \.self) { item in
                Button {
                    selected = item
                } label: {
                    Text(item)
                        .font(.system(size: 13, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 34)
                        .foregroundStyle(selected == item ? Color.ubeyeInk : Color.ubeyeMuted)
                        .background(selected == item ? .white : Color.clear)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(Color.ubeyeSubtle)
        .clipShape(Capsule())
        .overlay(
            Capsule()
                .stroke(Color.ubeyeBorder.opacity(0.7), lineWidth: 1)
        )
    }
}

struct ExpoMetricCard: View {
    let title: String
    let value: String
    var subtitle: String?
    var systemImage: String?
    var background: Color = .white

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.ubeyeMuted)
                Spacer()
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 14, weight: .bold))
                        .frame(width: 30, height: 30)
                        .foregroundStyle(Color.ubeyeMuted)
                        .background(Color.ubeyeSubtle, in: Circle())
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(value)
                    .font(.system(size: 24, weight: .bold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.68)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color.ubeyeMuted)
                        .lineLimit(2)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
        .padding(14)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct ExpoStoryImage: View {
    let url: URL?
    var cornerRadius: CGFloat = 8

    var body: some View {
        AsyncImage(url: url) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            LinearGradient(
                colors: [Color.ubeyeSubtle, Color.ubeyeMuted.opacity(0.22)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

func ubeyeCurrency(_ cents: Int?) -> String {
    let dollars = Double(cents ?? 0) / 100
    return dollars.formatted(.currency(code: "USD"))
}
