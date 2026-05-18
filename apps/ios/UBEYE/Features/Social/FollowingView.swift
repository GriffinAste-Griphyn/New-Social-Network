import SwiftUI

struct FollowingView: View {
    var body: some View {
        NavigationStack {
            ZStack {
                Text("Coming Soon")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Color.ubeyeInk)

                VStack(spacing: 0) {
                    HStack(alignment: .center) {
                        Text("Following")
                            .font(.system(size: 30, weight: .bold))
                            .foregroundStyle(Color.ubeyeInk)

                        Spacer()

                        TopAvatarSpacer()
                    }

                    Spacer()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, UBEYEMetrics.screenInset)
            .padding(.top, 16)
            .padding(.bottom, UBEYEMetrics.screenInset)
            .toolbar(.hidden, for: .navigationBar)
            .ubeyeScreen()
        }
    }
}
