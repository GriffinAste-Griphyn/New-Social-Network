import SwiftUI

struct RootView: View {
    @EnvironmentObject private var auth: AuthStore

    var body: some View {
        Group {
            if auth.account == nil {
                AuthView()
            } else {
                MainTabView()
            }
        }
        .animation(.snappy, value: auth.account?.mobileToken)
    }
}

struct MainTabView: View {
    init() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor.white
        appearance.shadowColor = UIColor(Color.ubeyeBorder)
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }

    var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Label("Stories", systemImage: "play.rectangle.fill")
                }

            DiscoverView()
                .tabItem {
                    Label("Discover", systemImage: "safari.fill")
                }

            StoryComposerView()
                .tabItem {
                    Label("Post", systemImage: "plus.circle.fill")
                }

            FollowingView()
                .tabItem {
                    Label("Following", systemImage: "person.2.fill")
                }

            ProfileView()
                .tabItem {
                    Label("Profile", systemImage: "person.crop.circle.fill")
                }
        }
        .tint(.ubeyeRed)
    }
}
