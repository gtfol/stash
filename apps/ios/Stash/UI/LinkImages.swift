import SwiftUI

/// A square preview for a list row. Until an image loads, or if it can't, the tile shows the
/// site's first letter, so a row is never blank.
struct LinkThumbnail: View {
    let imageURL: String?
    let host: String
    var size: CGFloat = 56
    @Environment(\.displayScale) private var displayScale
    @State private var image: CGImage?

    var body: some View {
        ZStack {
            StashStyle.surface
            if let image {
                Image(decorative: image, scale: 1).resizable().scaledToFill()
            } else {
                Text(host.first.map { String($0).lowercased() } ?? "·")
                    .font(.custom("Lato-Regular", fixedSize: size * 0.42))
                    .foregroundStyle(StashStyle.secondary)
            }
        }
        .frame(width: size, height: size)
        .clipped()
        .accessibilityHidden(true)
        .task(id: imageURL) {
            image = nil
            guard let imageURL else { return }
            image = await ThumbnailLoader.shared.image(for: imageURL, maxPixelSize: Int(size * displayScale))
        }
    }
}

/// The detail screen's preview. It takes up space only once an image has loaded.
struct PreviewImage: View {
    let imageURL: String?
    @State private var image: CGImage?

    var body: some View {
        VStack(spacing: 0) {
            if let image {
                Image(decorative: image, scale: 1)
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity)
                    .frame(height: 200)
                    .clipped()
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
        .task(id: imageURL) {
            guard let imageURL else { image = nil; return }
            let loaded = await ThumbnailLoader.shared.image(for: imageURL, maxPixelSize: 1_200)
            withAnimation(.easeOut(duration: 0.2)) { image = loaded }
        }
    }
}
