import Foundation

/// Page details read from the network. Every field is optional: a saved link is valid with just
/// its URL, and its title can fall back to the link itself.
struct LinkMetadata: Codable, Equatable, Sendable {
    var title: String?
    var summary: String?
    var imageURL: String?
    var siteName: String?
    var author: String?
    /// `yyyy-MM-dd` as the publisher wrote it, so the date never shifts across time zones.
    var publishedDate: String?
    var canonicalURL: String?

    var isEmpty: Bool { self == LinkMetadata() }

    /// Trimmed, length-limited values; blanks and non-web URLs become nil.
    func cleaned() -> LinkMetadata {
        LinkMetadata(title: Self.text(title, limit: 300), summary: Self.text(summary, limit: 600),
                     imageURL: Self.webURL(imageURL), siteName: Self.text(siteName, limit: 100),
                     author: Self.text(author, limit: 200), publishedDate: publishedDate.flatMap(PublicationDate.normalized),
                     canonicalURL: Self.webURL(canonicalURL))
    }

    /// A newer fetch replaces older fetched values field by field. A blank never erases a value
    /// that is already there, so a partial or failed refresh can't wipe details.
    func merged(with newer: LinkMetadata) -> LinkMetadata {
        let newer = newer.cleaned()
        return LinkMetadata(title: newer.title ?? title, summary: newer.summary ?? summary, imageURL: newer.imageURL ?? imageURL,
                            siteName: newer.siteName ?? siteName, author: newer.author ?? author,
                            publishedDate: newer.publishedDate ?? publishedDate, canonicalURL: newer.canonicalURL ?? canonicalURL)
    }

    static func text(_ value: String?, limit: Int) -> String? {
        guard let value else { return nil }
        let collapsed = value.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
        guard !collapsed.isEmpty else { return nil }
        return collapsed.count > limit ? String(collapsed.prefix(limit - 1)) + "…" : collapsed
    }

    static func webURL(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), value.count <= 2_048,
              let link = try? WebLink(value) else { return nil }
        return link.string
    }
}

/// Why details couldn't be read. Saving never depends on this.
enum MetadataFailure: String, Error, Codable, Equatable, Sendable {
    case offline, timedOut, unreachable, blocked, notFound, serverError, notWebPage, other

    /// Worth retrying automatically on a later launch or when the connection returns.
    var isTransient: Bool { ![.blocked, .notFound, .notWebPage].contains(self) }

    var message: String {
        switch self {
        case .offline: "you’re offline. details will load when you’re back online."
        case .timedOut: "the site took too long to answer."
        case .unreachable: "the site couldn’t be reached."
        case .blocked: "this site doesn’t allow previews."
        case .notFound: "the site says this page wasn’t found. the link is still saved."
        case .serverError: "the site had a problem. try again later."
        case .notWebPage: "this link isn’t a web page, so there are no details."
        case .other: "details couldn’t be loaded."
        }
    }

    /// A few words for a list caption.
    var shortMessage: String {
        switch self {
        case .offline: "offline"
        case .timedOut, .serverError, .other: "no details yet"
        case .unreachable: "site unreachable"
        case .blocked: "site blocks previews"
        case .notFound: "page not found"
        case .notWebPage: "not a web page"
        }
    }

    init(_ error: any Error) {
        if let failure = error as? MetadataFailure { self = failure; return }
        guard let error = error as? URLError else { self = .other; return }
        switch error.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff, .callIsActive:
            self = .offline
        case .timedOut: self = .timedOut
        case .cannotFindHost, .dnsLookupFailed, .cannotConnectToHost, .secureConnectionFailed,
             .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateNotYetValid,
             .serverCertificateHasUnknownRoot, .appTransportSecurityRequiresSecureConnection, .httpTooManyRedirects:
            self = .unreachable
        default: self = .other
        }
    }

    init(httpStatus status: Int) {
        switch status {
        case 404, 410: self = .notFound
        case 401, 402, 403, 407, 429, 451: self = .blocked
        case 500...599: self = .serverError
        default: self = .other
        }
    }
}

enum MetadataStatus: String, Codable, Equatable, Sendable {
    case pending, fetched, failed
}

/// Publication dates are calendar dates, stored as `yyyy-MM-dd` and shown without time zone math.
enum PublicationDate {
    /// Accepts ISO 8601 dates and date-times (`2026-09-18`, `2026-09-18T10:00:00+02:00`) and
    /// citation dates (`2026/09/18`). The date is taken as written.
    static func normalized(_ value: String) -> String? {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let digits = Array(text.prefix(10))
        guard digits.count == 10, digits[4] == digits[7], digits[4] == "-" || digits[4] == "/",
              let year = Int(String(digits[0...3])), let month = Int(String(digits[5...6])), let day = Int(String(digits[8...9])),
              (1900...2200).contains(year), (1...12).contains(month), (1...31).contains(day) else { return nil }
        if text.count > 10, let next = text.dropFirst(10).first, next.isNumber { return nil }
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    static func date(_ value: String) -> Date? {
        guard let normalized = normalized(value) else { return nil }
        let parts = normalized.split(separator: "-").compactMap { Int($0) }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    /// "Sep 18, 2026" in the reader's locale, for the calendar date as written.
    static func display(_ value: String, locale: Locale = .current) -> String? {
        guard let date = date(value) else { return nil }
        var style = Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale)
        style.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return date.formatted(style)
    }
}
