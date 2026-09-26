import Foundation
import LinkPresentation

/// The app's metadata source. The bounded HTML read supplies every field it can. LinkPresentation,
/// which reads pages the way Messages previews them, is asked for a title when that read is refused
/// or finds none. It exposes no description, site, author, date, or canonical link, and its image
/// arrives as data rather than a URL, so it complements the HTML read rather than replacing it.
struct SystemMetadataExtractor: LinkMetadataExtractor {
    var html = HTMLMetadataExtractor()

    func metadata(for url: URL) async throws -> LinkMetadata {
        do {
            var metadata = try await html.metadata(for: url)
            if metadata.title == nil, let title = await LinkPresentationTitle.title(for: HTMLMetadataExtractor.secureURL(url)) {
                metadata.title = title
            }
            return metadata.cleaned()
        } catch let failure as MetadataFailure where [.blocked, .serverError, .other].contains(failure) {
            try Task.checkCancellation()
            guard let title = await LinkPresentationTitle.title(for: HTMLMetadataExtractor.secureURL(url)) else { throw failure }
            return LinkMetadata(title: title).cleaned()
        }
    }
}

enum LinkPresentationTitle {
    /// A page title from LinkPresentation, or nil. Bot checks and blank titles count as nil.
    @MainActor static func title(for url: URL, timeout: TimeInterval = 12) async -> String? {
        let provider = LPMetadataProvider()
        provider.timeout = timeout
        provider.shouldFetchSubresources = false
        let handle = ProviderHandle(provider: provider)
        let title: String? = await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                provider.startFetchingMetadata(for: url) { @Sendable metadata, _ in
                    continuation.resume(returning: metadata?.title)
                }
            }
        } onCancel: {
            Task { @MainActor in handle.provider.cancel() }
        }
        guard let title = LinkMetadata.text(title, limit: 300), !HTMLMetadataParser.isInterstitialTitle(title),
              !isJustTheSiteName(title, of: url) else { return nil }
        return title
    }

    /// "archive.ph" or "Archive" names the site, not the page.
    static func isJustTheSiteName(_ title: String, of url: URL) -> Bool {
        guard let host = URLComponents(url: url, resolvingAgainstBaseURL: false)?.host else { return false }
        let site = WebLink.displayHost(host)
        let name = title.lowercased()
        return name == site || name == site.split(separator: ".").first.map(String.init)
    }

    // Lets the cancellation handler reach the provider; it is only used on the main actor.
    private final class ProviderHandle: @unchecked Sendable {
        let provider: LPMetadataProvider
        init(provider: LPMetadataProvider) { self.provider = provider }
    }
}
