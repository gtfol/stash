import Foundation

/// Reads details for a saved link. Implementations never change the saved link, and they stop
/// promptly when their task is cancelled.
protocol LinkMetadataExtractor: Sendable {
    func metadata(for url: URL) async throws -> LinkMetadata
}

/// Reads at most the first `byteLimit` bytes of a page, stopping early after `</head>`, and parses
/// its title and meta tags. No cookies, no cache, no scripts, no article bodies.
struct HTMLMetadataExtractor: LinkMetadataExtractor {
    var session: URLSession
    var byteLimit: Int
    var timeout: TimeInterval

    init(session: URLSession = HTMLMetadataExtractor.makeSession(), byteLimit: Int = 768 * 1_024, timeout: TimeInterval = 15) {
        self.session = session
        self.byteLimit = byteLimit
        self.timeout = timeout
    }

    static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 20
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }

    func metadata(for url: URL) async throws -> LinkMetadata {
        let target = Self.secureURL(url)
        var request = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.setValue("text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.bytes(for: request)
        defer { bytes.task.cancel() }
        guard let http = response as? HTTPURLResponse else { throw MetadataFailure.other }
        guard (200..<300).contains(http.statusCode) else { throw MetadataFailure(httpStatus: http.statusCode) }
        let contentType = http.value(forHTTPHeaderField: "Content-Type")
        guard Self.isHTML(contentType) else { throw MetadataFailure.notWebPage }

        var data = Data()
        data.reserveCapacity(64 * 1_024)
        let headEnd = Array("</head>".utf8)
        for try await byte in bytes {
            data.append(byte)
            if data.count >= byteLimit { break }
            if byte == UInt8(ascii: ">"), data.count >= headEnd.count,
               data.suffix(headEnd.count).map({ $0 >= 0x41 && $0 <= 0x5A ? $0 + 32 : $0 }) == headEnd { break }
        }
        try Task.checkCancellation()
        let page = HTMLMetadataParser.parse(HTMLMetadataParser.decode(data, contentType: contentType), baseURL: http.url ?? target)
        if page.isInterstitial { throw MetadataFailure.blocked }
        return page.metadata
    }

    static func isHTML(_ contentType: String?) -> Bool {
        guard let type = contentType?.lowercased().split(separator: ";").first?.trimmingCharacters(in: .whitespaces), !type.isEmpty else { return true }
        return type == "text/html" || type == "application/xhtml+xml"
    }

    /// Details and previews are read over https, which App Transport Security requires. The saved
    /// `http://` link is still what opens.
    static func secureURL(_ url: URL) -> URL {
        guard url.scheme?.lowercased() == "http", var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        components.scheme = "https"
        if components.port == 80 { components.port = nil }
        return components.url ?? url
    }
}
