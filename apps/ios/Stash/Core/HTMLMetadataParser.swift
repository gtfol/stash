import Foundation

/// Reads link details from the start of an HTML document: `<title>`, Open Graph, Twitter,
/// citation and Dublin Core meta tags, the canonical link, and JSON-LD articles. It is a small,
/// tolerant scanner, not a browser: it runs no scripts and only sees what the server sent.
enum HTMLMetadataParser {
    struct Page: Equatable, Sendable {
        var metadata: LinkMetadata
        /// A bot check, consent wall, or error page rather than the article.
        var isInterstitial: Bool
    }

    static func parse(_ html: String, baseURL: URL) -> Page {
        var scanner = TagScanner(bytes: Array(html.utf8))
        var documentTitle: String?
        var metas: [String: String] = [:]
        var citationAuthors: [String] = []
        var canonical: String?
        var base = baseURL
        var articles: [[String: Any]] = []
        var inHead = true

        while let tag = scanner.nextTag() {
            switch tag.name {
            case "title":
                let text = scanner.text(until: "title")
                if inHead, documentTitle == nil { documentTitle = decodeEntities(text) }
            case "meta":
                guard let content = tag.attributes["content"] else { continue }
                for key in ["property", "name", "itemprop"] {
                    guard let name = tag.attributes[key]?.lowercased(), !name.isEmpty else { continue }
                    if name == "citation_author" { citationAuthors.append(content) }
                    if metas[name] == nil { metas[name] = content }
                }
            case "link":
                let rel = tag.attributes["rel"]?.lowercased().split(separator: " ") ?? []
                if rel.contains("canonical"), canonical == nil { canonical = tag.attributes["href"] }
            case "base":
                if let href = tag.attributes["href"], let url = URL(string: href, relativeTo: baseURL) { base = url.absoluteURL }
            case "script":
                let text = scanner.text(until: "script")
                if tag.attributes["type"]?.lowercased().contains("ld+json") == true { articles += jsonLDObjects(text) }
            case "style", "template", "textarea", "noscript":
                _ = scanner.text(until: tag.name)
            case "/head", "body":
                inHead = false
            default:
                break
            }
        }

        let article = primaryArticle(in: articles)
        // Attribute values are already entity-decoded by the scanner; JSON-LD strings by `text`.
        func meta(_ keys: String...) -> String? {
            keys.lazy.compactMap { metas[$0] }.first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        }
        func resolved(_ value: String?) -> String? {
            guard let value, let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines), relativeTo: base) else { return nil }
            return url.absoluteURL.absoluteString
        }

        let title = meta("og:title", "twitter:title") ?? article.flatMap { text($0["headline"]) ?? text($0["name"]) }
            ?? meta("citation_title", "dc.title", "parsely-title") ?? documentTitle
        let author = article.flatMap { authorNames($0["author"]) }
            ?? meta("author", "parsely-author", "sailthru.author", "dc.creator").flatMap(nonURL)
            ?? meta("article:author").flatMap(nonURL)
            ?? citationAuthors.first.map(readableName)
        let published = meta("article:published_time") ?? article.flatMap { text($0["datePublished"]) ?? text($0["uploadDate"]) }
            ?? meta("citation_publication_date", "citation_date", "citation_online_date", "dc.date", "parsely-pub-date",
                    "sailthru.date", "pubdate", "publish-date", "article.published", "date")
        let image = meta("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src")
            ?? article.flatMap { imageURL($0["image"]) }
        let siteName = meta("og:site_name") ?? article.flatMap { ($0["publisher"] as? [String: Any]).flatMap { text($0["name"]) } }
            ?? meta("application-name", "citation_journal_title", "dc.publisher")
        let canonicalURL = canonical ?? meta("og:url") ?? article.flatMap { text($0["url"]) }

        let metadata = LinkMetadata(
            title: title,
            summary: meta("og:description", "twitter:description", "description") ?? article.flatMap { text($0["description"]) },
            imageURL: resolved(image),
            siteName: siteName,
            author: author,
            publishedDate: published.flatMap(PublicationDate.normalized),
            canonicalURL: resolved(canonicalURL)
        ).cleaned()
        let titles = [metadata.title, documentTitle].compactMap { $0 }
        return Page(metadata: metadata, isInterstitial: titles.contains(where: isInterstitialTitle))
    }

    // MARK: Interstitials

    private static let interstitialTitles: Set<String> = [
        "just a moment...", "just a moment…", "attention required! | cloudflare", "access denied", "access to this page has been denied",
        "please wait...", "please wait…", "security check", "one more step", "are you a robot?", "robot check", "captcha",
        "verify you are human", "verification required", "before you continue", "before you continue to youtube",
        "forbidden", "403 forbidden", "error", "ddos-guard", "request rejected", "you have been blocked"
    ]
    private static let interstitialPrefixes = ["checking your browser", "attention required", "access denied", "please enable cookies", "enable javascript"]

    static func isInterstitialTitle(_ title: String) -> Bool {
        let title = title.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        return interstitialTitles.contains(title) || (title.count < 60 && interstitialPrefixes.contains { title.hasPrefix($0) })
    }

    // MARK: JSON-LD

    static func jsonLDObjects(_ text: String) -> [[String: Any]] {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return [] }
        var objects: [[String: Any]] = []
        func visit(_ value: Any, depth: Int) {
            guard depth < 6 else { return }
            if let array = value as? [Any] {
                for element in array { visit(element, depth: depth + 1) }
            } else if let object = value as? [String: Any] {
                objects.append(object)
                if let graph = object["@graph"] { visit(graph, depth: depth + 1) }
            }
        }
        visit(json, depth: 0)
        return objects
    }

    private static let articleTypes: Set<String> = [
        "article", "newsarticle", "blogposting", "reportagenewsarticle", "analysisnewsarticle", "opinionnewsarticle",
        "scholarlyarticle", "techarticle", "report", "videoobject", "podcastepisode", "review"
    ]

    private static func primaryArticle(in objects: [[String: Any]]) -> [String: Any]? {
        func types(_ object: [String: Any]) -> [String] {
            if let type = object["@type"] as? String { return [type.lowercased()] }
            return (object["@type"] as? [Any])?.compactMap { ($0 as? String)?.lowercased() } ?? []
        }
        return objects.first { !articleTypes.isDisjoint(with: types($0)) } ?? objects.first { types($0).contains("webpage") }
    }

    private static func text(_ value: Any?) -> String? {
        switch value {
        case let string as String: string.isEmpty ? nil : decodeEntities(string)
        case let object as [String: Any]: text(object["@value"]) ?? text(object["name"]) ?? text(object["@id"])
        case let array as [Any]: array.lazy.compactMap { text($0) }.first
        default: nil
        }
    }

    private static func imageURL(_ value: Any?) -> String? {
        switch value {
        case let string as String: decodeEntities(string)
        case let object as [String: Any]: text(object["url"]) ?? text(object["contentUrl"])
        case let array as [Any]: array.lazy.compactMap { imageURL($0) }.first
        default: nil
        }
    }

    private static func authorNames(_ value: Any?) -> String? {
        let people: [Any] = (value as? [Any]) ?? (value.map { [$0] } ?? [])
        let names = people.compactMap { person -> String? in
            if let name = person as? String { return nonURL(decodeEntities(name)) }
            return (person as? [String: Any]).flatMap { text($0["name"]) }
        }
        return names.isEmpty ? nil : names.prefix(3).joined(separator: ", ")
    }

    private static func nonURL(_ value: String) -> String? {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty || value.contains("://") ? nil : value
    }

    /// "Peeples, Lynne" → "Lynne Peeples", as citation tags list surnames first.
    private static func readableName(_ value: String) -> String {
        let parts = value.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        return parts.count == 2 && !parts[1].isEmpty ? "\(parts[1]) \(parts[0])" : value
    }

    // MARK: Entities

    static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        var result = ""
        var index = text.startIndex
        while let ampersand = text[index...].firstIndex(of: "&") {
            result += text[index..<ampersand]
            let afterAmpersand = text.index(after: ampersand)
            if let semicolon = text[afterAmpersand...].prefix(10).firstIndex(of: ";"),
               let decoded = entity(text[afterAmpersand..<semicolon]) {
                result += decoded
                index = text.index(after: semicolon)
            } else {
                result += "&"
                index = afterAmpersand
            }
        }
        result += text[index...]
        return result
    }

    private static func entity(_ name: Substring) -> String? {
        if name.hasPrefix("#x") || name.hasPrefix("#X") {
            return UInt32(name.dropFirst(2), radix: 16).flatMap { Unicode.Scalar($0) }.map { String($0) }
        }
        if name.hasPrefix("#") { return UInt32(name.dropFirst(), radix: 10).flatMap { Unicode.Scalar($0) }.map { String($0) } }
        return namedEntities[String(name)]
    }

    private static let namedEntities: [String: String] = [
        "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " ", "hellip": "…", "mdash": "—", "ndash": "–",
        "lsquo": "‘", "rsquo": "’", "ldquo": "“", "rdquo": "”", "laquo": "«", "raquo": "»", "middot": "·", "bull": "•",
        "copy": "©", "reg": "®", "trade": "™", "eacute": "é", "egrave": "è", "aacute": "á", "agrave": "à", "iacute": "í",
        "oacute": "ó", "uacute": "ú", "ntilde": "ñ", "ouml": "ö", "uuml": "ü", "auml": "ä", "szlig": "ß", "ccedil": "ç"
    ]

    // MARK: Character sets

    /// Decodes a (possibly truncated) response using the HTTP charset, a byte-order mark, or a
    /// `<meta charset>` near the start, falling back from UTF-8 to Windows-1252.
    static func decode(_ data: Data, contentType: String?) -> String {
        let declared = charset(inContentType: contentType) ?? sniffedCharset(data)
        if let declared, let encoding = encoding(named: declared), encoding != .utf8 {
            for trim in 0...3 where data.count > trim {
                if let text = String(data: data.dropLast(trim), encoding: encoding) { return text }
            }
        }
        for trim in 0...3 where data.count > trim {
            if let text = String(data: data.dropLast(trim), encoding: .utf8) { return text }
        }
        if declared == nil, let text = String(data: data, encoding: .windowsCP1252) { return text }
        return String(decoding: data, as: UTF8.self)
    }

    static func charset(inContentType contentType: String?) -> String? {
        guard let contentType = contentType?.lowercased(), let range = contentType.range(of: "charset=") else { return nil }
        let value = contentType[range.upperBound...].prefix { $0 != ";" }
        let trimmed = value.trimmingCharacters(in: CharacterSet(charactersIn: "\"' "))
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func sniffedCharset(_ data: Data) -> String? {
        if data.starts(with: [0xEF, 0xBB, 0xBF]) { return "utf-8" }
        if data.starts(with: [0xFE, 0xFF]) || data.starts(with: [0xFF, 0xFE]) { return "utf-16" }
        let head = String(decoding: data.prefix(4_096), as: UTF8.self)
        guard let match = head.range(of: #"<meta[^>]+charset\s*=\s*["']?[A-Za-z0-9_\-:.]+"#, options: [.regularExpression, .caseInsensitive]),
              let equals = head[match].range(of: "charset", options: .caseInsensitive) else { return nil }
        let value = head[match][equals.upperBound...].drop { $0 == "=" || $0 == " " || $0 == "\"" || $0 == "'" }
        return value.isEmpty ? nil : value.lowercased()
    }

    private static func encoding(named name: String) -> String.Encoding? {
        let encoding = CFStringConvertIANACharSetNameToEncoding(name as CFString)
        guard encoding != kCFStringEncodingInvalidId else { return nil }
        return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(encoding))
    }
}

/// Finds tags and their attributes in HTML bytes. Comments, doctypes, and stray `<` are skipped;
/// raw text inside `<script>`/`<style>` is read with `text(until:)` so it can't look like tags.
private struct TagScanner {
    struct Tag {
        var name: String
        var attributes: [String: String]
    }

    let bytes: [UInt8]
    var index = 0

    mutating func nextTag() -> Tag? {
        while index < bytes.count {
            guard let open = bytes[index...].firstIndex(of: UInt8(ascii: "<")) else { index = bytes.count; return nil }
            index = open + 1
            if matches("!--", at: index) {
                index = find(Array("-->".utf8), from: index + 3).map { $0 + 3 } ?? bytes.count
                continue
            }
            let closing = index < bytes.count && bytes[index] == UInt8(ascii: "/")
            if closing { index += 1 }
            let start = index
            while index < bytes.count, Self.isNameByte(bytes[index]) { index += 1 }
            guard index > start else {
                if index < bytes.count, bytes[index] == UInt8(ascii: "!") || bytes[index] == UInt8(ascii: "?") { skipPastTagEnd() }
                continue
            }
            let name = Self.lowercased(bytes[start..<index])
            if closing { skipPastTagEnd(); return Tag(name: "/" + name, attributes: [:]) }
            return Tag(name: name, attributes: attributes())
        }
        return nil
    }

    /// Raw text up to the closing tag, leaving the scanner at that closing tag.
    mutating func text(until name: String) -> String {
        let start = index
        let end = find(Array("</\(name)".utf8), from: index, caseInsensitive: true) ?? bytes.count
        index = end
        return String(decoding: bytes[start..<end], as: UTF8.self)
    }

    private mutating func attributes() -> [String: String] {
        var result: [String: String] = [:]
        while index < bytes.count {
            while index < bytes.count, Self.isSpace(bytes[index]) || bytes[index] == UInt8(ascii: "/") { index += 1 }
            guard index < bytes.count else { break }
            if bytes[index] == UInt8(ascii: ">") { index += 1; break }
            let nameStart = index
            while index < bytes.count, !Self.isSpace(bytes[index]), ![UInt8(ascii: "="), UInt8(ascii: ">"), UInt8(ascii: "/")].contains(bytes[index]) {
                index += 1
            }
            let name = Self.lowercased(bytes[nameStart..<index])
            while index < bytes.count, Self.isSpace(bytes[index]) { index += 1 }
            var value = ""
            if index < bytes.count, bytes[index] == UInt8(ascii: "=") {
                index += 1
                while index < bytes.count, Self.isSpace(bytes[index]) { index += 1 }
                if index < bytes.count, bytes[index] == UInt8(ascii: "\"") || bytes[index] == UInt8(ascii: "'") {
                    let quote = bytes[index]
                    let valueStart = index + 1
                    let valueEnd = bytes[valueStart...].firstIndex(of: quote) ?? bytes.count
                    value = String(decoding: bytes[valueStart..<valueEnd], as: UTF8.self)
                    index = min(valueEnd + 1, bytes.count)
                } else {
                    let valueStart = index
                    while index < bytes.count, !Self.isSpace(bytes[index]), bytes[index] != UInt8(ascii: ">") { index += 1 }
                    value = String(decoding: bytes[valueStart..<index], as: UTF8.self)
                }
            }
            if !name.isEmpty, result[name] == nil { result[name] = HTMLMetadataParser.decodeEntities(value) }
        }
        return result
    }

    private mutating func skipPastTagEnd() {
        index = bytes[index...].firstIndex(of: UInt8(ascii: ">")).map { $0 + 1 } ?? bytes.count
    }

    private func matches(_ text: String, at position: Int) -> Bool {
        let pattern = Array(text.utf8)
        return position + pattern.count <= bytes.count && Array(bytes[position..<position + pattern.count]) == pattern
    }

    private func find(_ pattern: [UInt8], from position: Int, caseInsensitive: Bool = false) -> Int? {
        guard !pattern.isEmpty, pattern.count <= bytes.count else { return nil }
        var candidate = position
        while candidate + pattern.count <= bytes.count {
            var matched = true
            for offset in 0..<pattern.count {
                let byte = bytes[candidate + offset]
                if (caseInsensitive ? Self.lower(byte) : byte) != pattern[offset] { matched = false; break }
            }
            if matched { return candidate }
            candidate += 1
        }
        return nil
    }

    private static func isNameByte(_ byte: UInt8) -> Bool {
        (byte >= 0x61 && byte <= 0x7A) || (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x30 && byte <= 0x39) || byte == UInt8(ascii: "-") || byte == UInt8(ascii: ":")
    }

    private static func isSpace(_ byte: UInt8) -> Bool { byte == 0x20 || byte == 0x09 || byte == 0x0A || byte == 0x0D || byte == 0x0C }

    private static func lower(_ byte: UInt8) -> UInt8 { byte >= 0x41 && byte <= 0x5A ? byte + 32 : byte }

    private static func lowercased(_ bytes: ArraySlice<UInt8>) -> String {
        String(decoding: bytes.map(lower), as: UTF8.self)
    }
}
