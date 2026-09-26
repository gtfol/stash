import Foundation

/// A web link someone chose to save. `string` is exactly what they entered (trimmed) and is what
/// opening the item uses. `dedupeKey` only decides whether two saves are the same page.
struct WebLink: Hashable, Sendable {
    let string: String
    let url: URL
    let dedupeKey: String
}

enum LinkError: Error, Equatable, Sendable, LocalizedError {
    case empty, invalid, tooLong, noLink, multipleLinks
    case unsupportedScheme(String)

    var errorDescription: String? {
        switch self {
        case .empty: "paste or type a link."
        case .invalid: "that isn’t a web link. nothing was saved."
        case .tooLong: "that link is too long. nothing was saved."
        case .noLink: "no link found. nothing was saved."
        case .multipleLinks: "more than one link found. nothing was saved. share one link at a time."
        case .unsupportedScheme(let scheme): "stash saves http and https links, not \(scheme) links. nothing was saved."
        }
    }
}

extension WebLink {
    static let maximumLength = 8_192

    /// Exactly one explicit http(s) URL, such as a shared URL item or an inbox record.
    init(_ text: String) throws {
        let candidate = Self.unwrapped(text)
        guard !candidate.isEmpty else { throw LinkError.empty }
        guard candidate.count <= Self.maximumLength else { throw LinkError.tooLong }
        guard candidate.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              let scheme = Self.scheme(of: candidate) else { throw LinkError.invalid }
        guard scheme == "http" || scheme == "https" else { throw LinkError.unsupportedScheme(scheme) }
        guard candidate.lowercased().hasPrefix(scheme + "://"),
              let url = URL(string: candidate),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let host = components.host, !host.isEmpty else { throw LinkError.invalid }
        string = candidate
        self.url = url
        dedupeKey = Self.dedupeKey(for: components)
    }

    /// What someone typed or pasted into the add field. A bare domain such as `example.com/a`
    /// becomes `https://example.com/a`; the add field shows that before saving.
    static func typed(_ text: String) throws -> WebLink {
        let candidate = unwrapped(text)
        guard !candidate.isEmpty else { throw LinkError.empty }
        if candidate.rangeOfCharacter(from: .whitespacesAndNewlines) != nil { return try found(in: candidate) }
        if scheme(of: candidate) != nil { return try WebLink(candidate) }
        guard looksLikeHost(candidate) else { throw LinkError.invalid }
        return try WebLink("https://" + candidate)
    }

    /// The single explicit http(s) link in free text. Bare domains are not treated as links, and
    /// two different links are ambiguous, so neither case guesses.
    static func found(in text: String) throws -> WebLink {
        let scan = scan(text)
        if scan.links.count == 1 { return scan.links[0] }
        if scan.links.count > 1 { throw LinkError.multipleLinks }
        if let scheme = scan.otherSchemes.first { throw LinkError.unsupportedScheme(scheme) }
        throw LinkError.noLink
    }

    struct TextScan: Sendable {
        var links: [WebLink] = []
        var otherSchemes: [String] = []
    }

    /// Explicit links in text, in order, one per page (by dedupe key).
    static func scan(_ text: String) -> TextScan {
        var result = TextScan()
        guard !text.isEmpty,
              let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return result }
        var seen = Set<String>()
        for match in detector.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let range = Range(match.range, in: text) else { continue }
            let written = String(text[range])
            guard let scheme = scheme(of: written) else { continue }
            if let link = try? WebLink(written) {
                if seen.insert(link.dedupeKey).inserted { result.links.append(link) }
            } else if scheme != "http" && scheme != "https" {
                result.otherSchemes.append(scheme)
            }
        }
        return result
    }

    /// The URL scheme the text starts with, lowercased. `example.com:8080/a` is a host and port.
    static func scheme(of text: String) -> String? {
        guard let colon = text.firstIndex(of: ":") else { return nil }
        let name = text[..<colon]
        guard let first = name.first, first.isASCII, first.isLetter,
              name.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "+-.".contains($0)) }) else { return nil }
        if text[text.index(after: colon)...].first?.isNumber == true { return nil }
        return name.lowercased()
    }

    /// Removes surrounding whitespace and one pair of wrapping brackets or quotes, as copied from
    /// mail or chat (`<https://…>`). Nothing inside the link changes.
    static func unwrapped(_ text: String) -> String {
        var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let pairs: [(Character, Character)] = [("<", ">"), ("\"", "\""), ("'", "'"), ("“", "”"), ("‘", "’"), ("(", ")"), ("[", "]")]
        for (open, close) in pairs where value.count >= 2 && value.first == open && value.last == close {
            value = String(value.dropFirst().dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
            break
        }
        return value
    }

    private static func looksLikeHost(_ text: String) -> Bool {
        let authority = text.prefix { $0 != "/" && $0 != "?" && $0 != "#" }
        let name = authority.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
        let labels = name.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, let tld = labels.last, tld.count >= 2, tld.allSatisfy(\.isLetter) else { return false }
        return labels.allSatisfy { label in !label.isEmpty && label.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" } }
    }
}

// MARK: - Dedupe key

extension WebLink {
    /// One key per page: https, lowercase host without `www.`, no default port, no trailing slash,
    /// no tracking parameters, no fragment. Meaningful query parameters (`?v=`, `?id=`, `?p=`) and
    /// route-like fragments (`#/inbox`, `#!/page`) are kept, so different pages never collapse.
    static func dedupeKey(for components: URLComponents) -> String {
        var key = URLComponents()
        key.scheme = "https"
        let host = displayHost(components.host ?? "")
        key.host = host
        if let port = components.port, port != 80, port != 443 { key.port = port }
        var path = components.percentEncodedPath
        if path.isEmpty { path = "/" } else if path.count > 1, path.hasSuffix("/") { path.removeLast() }
        key.percentEncodedPath = path
        let query = (components.percentEncodedQueryItems ?? []).filter { !isTracking($0.name, host: host) }
        key.percentEncodedQueryItems = query.isEmpty ? nil : query
        if let fragment = components.percentEncodedFragment, fragment.hasPrefix("/") || fragment.hasPrefix("!") {
            key.percentEncodedFragment = fragment
        }
        return key.string ?? components.string ?? ""
    }

    private static let trackingPrefixes = ["utm_", "pk_", "mtm_"]
    private static let trackingNames: Set<String> = [
        "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid",
        "li_fat_id", "igshid", "igsh", "mc_cid", "mc_eid", "_hsenc", "_hsmi", "__hstc", "__hssc", "__hsfp",
        "hsctatracking", "mkt_tok", "oly_anon_id", "oly_enc_id", "rb_clickid", "s_cid", "vero_conv", "vero_id",
        "wickedid", "ref_src", "ref_url", "_ga", "_gl", "srsltid", "smid", "ocid", "xtor", "at_medium", "at_campaign"
    ]
    // Share and campaign parameters that only mean "how this link was passed around" on these sites.
    private static let siteTrackingNames: [String: Set<String>] = [
        "youtube.com": ["si", "feature", "pp"], "youtu.be": ["si", "feature"], "open.spotify.com": ["si"],
        "x.com": ["s", "t"], "twitter.com": ["s", "t"], "linkedin.com": ["trk", "trackingid", "lipi"],
        "reddit.com": ["share_id"]
    ]

    static func isTracking(_ name: String, host: String) -> Bool {
        let name = name.lowercased()
        if trackingNames.contains(name) || trackingPrefixes.contains(where: { name.hasPrefix($0) }) { return true }
        return siteTrackingNames.contains { site, names in
            (host == site || host.hasSuffix("." + site)) && names.contains(name)
        }
    }
}

// MARK: - Display helpers

extension WebLink {
    /// Lowercased host without a leading `www.`.
    static func displayHost(_ host: String) -> String {
        let host = host.lowercased()
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// Host of a stored link string, for captions ("archive.ph").
    static func displayHost(ofLink string: String) -> String? {
        guard let url = URL(string: string), let host = URLComponents(url: url, resolvingAgainstBaseURL: false)?.host,
              !host.isEmpty else { return nil }
        return displayHost(host)
    }

    /// A readable stand-in title when a page provides none: host and path without the scheme.
    static func fallbackTitle(for string: String) -> String {
        guard let url = URL(string: string),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let host = components.host, !host.isEmpty else { return string }
        let path = components.path == "/" ? "" : components.path
        return String((displayHost(host) + path).prefix(200))
    }
}
