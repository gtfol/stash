import Foundation
import SwiftData

/// SwiftData storage for `SavedItemRecord`, field for field. Layers stay in separate columns so a
/// metadata refresh can never overwrite the user's title or the known attribution.
@Model final class SavedItem {
    @Attribute(.unique) var id: UUID
    var url: String
    var dedupeKey: String
    var createdAt: Date
    var lastSavedAt: Date
    var updatedAt: Date
    var origin: String
    var customTitle: String?
    var knownTitle: String?
    var knownSiteName: String?
    var knownAuthor: String?
    var knownPublishedDate: String?
    var originalURL: String?
    var pageTitle: String?
    var pageSummary: String?
    var pageImageURL: String?
    var pageSiteName: String?
    var pageAuthor: String?
    var pagePublishedDate: String?
    var pageCanonicalURL: String?
    var metadataStatus: String
    var metadataFailure: String?
    var metadataAttempts: Int
    var metadataCheckedAt: Date?

    init(_ record: SavedItemRecord) {
        id = record.id
        url = record.url
        dedupeKey = record.dedupeKey
        createdAt = record.createdAt
        lastSavedAt = record.lastSavedAt
        updatedAt = record.updatedAt
        origin = record.origin.rawValue
        customTitle = record.customTitle
        knownTitle = record.known?.title
        knownSiteName = record.known?.siteName
        knownAuthor = record.known?.author
        knownPublishedDate = record.known?.publishedDate
        originalURL = record.known?.originalURL
        pageTitle = record.page.title
        pageSummary = record.page.summary
        pageImageURL = record.page.imageURL
        pageSiteName = record.page.siteName
        pageAuthor = record.page.author
        pagePublishedDate = record.page.publishedDate
        pageCanonicalURL = record.page.canonicalURL
        metadataStatus = record.metadataStatus.rawValue
        metadataFailure = record.metadataFailure?.rawValue
        metadataAttempts = record.metadataAttempts
        metadataCheckedAt = record.metadataCheckedAt
    }

    var record: SavedItemRecord {
        let known = KnownDetails(title: knownTitle, siteName: knownSiteName, author: knownAuthor,
                                 publishedDate: knownPublishedDate, originalURL: originalURL)
        let page = LinkMetadata(title: pageTitle, summary: pageSummary, imageURL: pageImageURL, siteName: pageSiteName,
                                author: pageAuthor, publishedDate: pagePublishedDate, canonicalURL: pageCanonicalURL)
        return SavedItemRecord(id: id, url: url, dedupeKey: dedupeKey, createdAt: createdAt, lastSavedAt: lastSavedAt,
                               updatedAt: updatedAt, origin: SavedItemRecord.Origin(rawValue: origin) ?? .app,
                               customTitle: customTitle, known: known == KnownDetails() ? nil : known, page: page,
                               metadataStatus: MetadataStatus(rawValue: metadataStatus) ?? .pending,
                               metadataFailure: metadataFailure.flatMap { MetadataFailure(rawValue: $0) },
                               metadataAttempts: metadataAttempts, metadataCheckedAt: metadataCheckedAt)
    }

    /// Writes every field except the identity.
    func apply(_ record: SavedItemRecord) {
        url = record.url
        dedupeKey = record.dedupeKey
        createdAt = record.createdAt
        lastSavedAt = record.lastSavedAt
        updatedAt = record.updatedAt
        origin = record.origin.rawValue
        customTitle = record.customTitle
        knownTitle = record.known?.title
        knownSiteName = record.known?.siteName
        knownAuthor = record.known?.author
        knownPublishedDate = record.known?.publishedDate
        originalURL = record.known?.originalURL
        pageTitle = record.page.title
        pageSummary = record.page.summary
        pageImageURL = record.page.imageURL
        pageSiteName = record.page.siteName
        pageAuthor = record.page.author
        pagePublishedDate = record.page.publishedDate
        pageCanonicalURL = record.page.canonicalURL
        metadataStatus = record.metadataStatus.rawValue
        metadataFailure = record.metadataFailure?.rawValue
        metadataAttempts = record.metadataAttempts
        metadataCheckedAt = record.metadataCheckedAt
    }
}
