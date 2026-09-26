import Foundation

/// Everything stash keeps about one saved link, as a plain value. The SwiftData model mirrors it
/// field for field, and it is the shape to export or sync later.
///
/// Details are kept in layers so each has one owner: `customTitle` belongs to the user, `known`
/// to whoever supplied the item (the first-launch article), and `page` to metadata fetches.
/// Fetches only ever write `page`, and `url` is never rewritten by anything.
struct SavedItemRecord: Codable, Equatable, Sendable, Identifiable {
    enum Origin: String, Codable, Sendable { case app, share, seed }

    var id = UUID()
    /// Opened exactly as saved.
    var url: String
    var dedupeKey: String
    var createdAt: Date
    var lastSavedAt: Date
    var updatedAt: Date
    var origin: Origin
    var customTitle: String?
    var known: KnownDetails?
    var page = LinkMetadata()
    var metadataStatus: MetadataStatus = .pending
    var metadataFailure: MetadataFailure?
    /// Completed fetch attempts; offline attempts don't count.
    var metadataAttempts = 0
    var metadataCheckedAt: Date?
}

/// Attribution supplied with an item rather than fetched. Fetches never replace these values.
struct KnownDetails: Codable, Equatable, Sendable {
    var title: String?
    var siteName: String?
    var author: String?
    var publishedDate: String?
    /// The publisher's page, for attribution only. Opening the item still uses its saved `url`.
    var originalURL: String?
}

extension SavedItemRecord {
    static let automaticAttemptLimit = 3

    init(link: WebLink, savedAt: Date, origin: Origin) {
        self.init(url: link.string, dedupeKey: link.dedupeKey, createdAt: savedAt, lastSavedAt: savedAt,
                  updatedAt: savedAt, origin: origin)
    }

    // MARK: Changes

    /// Another save of the same page keeps the original link and details and moves the item to
    /// the top. Applying the same save twice changes nothing, so re-importing is harmless.
    mutating func recordSave(at savedAt: Date, now: Date) -> Bool {
        guard savedAt > lastSavedAt else { return false }
        lastSavedAt = savedAt
        updatedAt = now
        return true
    }

    /// A blank title returns to the automatic one.
    mutating func rename(_ title: String, now: Date) -> Bool {
        let cleaned = LinkMetadata.text(title, limit: 300)
        let newValue = cleaned == automaticTitle && customTitle == nil ? nil : cleaned
        guard newValue != customTitle else { return false }
        customTitle = newValue
        updatedAt = now
        return true
    }

    mutating func applyMetadata(_ metadata: LinkMetadata, at now: Date) {
        page = page.merged(with: metadata)
        metadataStatus = .fetched
        metadataFailure = nil
        metadataAttempts += 1
        metadataCheckedAt = now
        updatedAt = now
    }

    mutating func recordMetadataFailure(_ failure: MetadataFailure, at now: Date) {
        metadataStatus = .failed
        metadataFailure = failure
        if failure != .offline { metadataAttempts += 1 }
        metadataCheckedAt = now
        updatedAt = now
    }

    /// Fetch without being asked: new items, and transient failures a few times.
    var wantsAutomaticMetadata: Bool {
        switch metadataStatus {
        case .pending: true
        case .fetched: false
        case .failed: (metadataFailure?.isTransient ?? true) && metadataAttempts < Self.automaticAttemptLimit
        }
    }

    // MARK: Display

    var title: String { customTitle ?? automaticTitle }
    var automaticTitle: String { known?.title ?? page.title ?? WebLink.fallbackTitle(for: url) }
    /// False while the title is only the link itself.
    var hasTitle: Bool { customTitle != nil || known?.title != nil || page.title != nil }
    var host: String { WebLink.displayHost(ofLink: url) ?? url }
    var source: String? { known?.siteName ?? page.siteName }
    var author: String? { known?.author ?? page.author }
    var publishedDate: String? { known?.publishedDate ?? page.publishedDate }

    /// The publisher's page when it is a different page from the saved link, for attribution.
    var originalURL: String? {
        if let original = known?.originalURL { return original }
        guard let canonical = page.canonicalURL, let link = try? WebLink(canonical), link.dedupeKey != dedupeKey else { return nil }
        return canonical
    }

    /// Every word must appear in the title, source, domain, or link. Case and accents are ignored.
    func matches(_ query: String) -> Bool {
        let words = query.split(whereSeparator: \.isWhitespace)
        guard !words.isEmpty else { return true }
        let text = [title, automaticTitle, source ?? "", host, url].joined(separator: "\n")
        return words.allSatisfy { text.range(of: $0, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
    }
}

/// The article stash opens with, offered exactly once per installation.
enum Seed {
    /// Set once the article has been offered and never cleared, so deleting it, clearing the
    /// library, or replacing the store in a later migration never brings it back.
    static let defaultsKey = "stash.seed.nature-how-to-make-a-brain"
    static let url = "https://archive.ph/GDsbC"
    static let originalURL = "https://www.nature.com/articles/d41586-026-02943-1"

    static func record(at date: Date) -> SavedItemRecord? {
        guard let link = try? WebLink(url) else { return nil }
        var record = SavedItemRecord(link: link, savedAt: date, origin: .seed)
        record.known = KnownDetails(title: "How to make a brain: new experiments challenge existing picture", siteName: "Nature",
                                    author: "Lynne Peeples", publishedDate: "2026-09-18", originalURL: originalURL)
        return record
    }

    /// Keys that mean the library already has this article: the archive or the publisher's page.
    static var dedupeKeys: [String] { [url, originalURL].compactMap { try? WebLink($0).dedupeKey } }
}
