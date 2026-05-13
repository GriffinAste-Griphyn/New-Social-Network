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
    var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Label("Home", systemImage: "house.fill")
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
