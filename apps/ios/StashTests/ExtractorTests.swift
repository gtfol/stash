import XCTest
#if canImport(Stash)
@testable import Stash
#else
@testable import StashCore
#endif

/// Serves canned responses by URL. Anything unlisted fails as an unknown host, so a test also
/// proves which URL the extractor actually requested.
final class StubProtocol: URLProtocol {
    struct Reply: Sendable {
        var status = 200
        var contentType = "text/html; charset=utf-8"
        var body = Data()
        var error: URLError?
    }

    static let replies: [String: Reply] = [
        "https://example.com/article": Reply(body: Data("""
            <head><title>Example | Site</title><meta property="og:title" content="Example article">
            <meta property="og:site_name" content="Example"></head>
            """.utf8)),
        "https://example.com/forbidden": Reply(status: 403),
        "https://example.com/missing": Reply(status: 404),
        "https://example.com/down": Reply(status: 503),
        "https://example.com/report.pdf": Reply(contentType: "application/pdf", body: Data("%PDF-1.7".utf8)),
        "https://example.com/offline": Reply(error: URLError(.notConnectedToInternet)),
        "https://example.com/challenge": Reply(body: Data("<head><title>Just a moment...</title></head>".utf8)),
        "https://example.com/huge": Reply(body: Data(("<head><title>Big page</title>" + String(repeating: "<p>filler</p>", count: 200_000)).utf8))
    ]

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        guard let url = request.url, let reply = Self.replies[url.absoluteString] else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotFindHost))
            return
        }
        if let error = reply.error {
            client?.urlProtocol(self, didFailWithError: error)
            return
        }
        let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": reply.contentType])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.body)
        client?.urlProtocolDidFinishLoading(self)
    }
}

final class ExtractorTests: XCTestCase {
    private func extractor(byteLimit: Int = 768 * 1_024) -> HTMLMetadataExtractor {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return HTMLMetadataExtractor(session: URLSession(configuration: configuration), byteLimit: byteLimit, timeout: 5)
    }

    private func failure(for link: String) async -> MetadataFailure? {
        do {
            _ = try await extractor().metadata(for: URL(string: link)!)
            return nil
        } catch {
            return MetadataFailure(error)
        }
    }

    func testReadsPageDetailsOverHTTPSForAnHTTPLink() async throws {
        let metadata = try await extractor().metadata(for: URL(string: "http://example.com/article")!)
        XCTAssertEqual(metadata.title, "Example article")
        XCTAssertEqual(metadata.siteName, "Example")
    }

    func testFailuresAreClassified() async {
        let expectations: [(String, MetadataFailure)] = [
            ("https://example.com/forbidden", .blocked), ("https://example.com/missing", .notFound),
            ("https://example.com/down", .serverError), ("https://example.com/report.pdf", .notWebPage),
            ("https://example.com/offline", .offline), ("https://example.com/challenge", .blocked),
            ("https://unknown.example.com/", .unreachable)
        ]
        for (link, expected) in expectations {
            let failure = await failure(for: link)
            XCTAssertEqual(failure, expected, link)
        }
    }

    func testStopsReadingAtTheByteLimit() async throws {
        let metadata = try await extractor(byteLimit: 4_096).metadata(for: URL(string: "https://example.com/huge")!)
        XCTAssertEqual(metadata.title, "Big page")
    }

    func testSecureURLOnlyChangesTheFetchNotTheLink() {
        XCTAssertEqual(HTMLMetadataExtractor.secureURL(URL(string: "http://example.com:80/a?b=1")!).absoluteString, "https://example.com/a?b=1")
        XCTAssertEqual(HTMLMetadataExtractor.secureURL(URL(string: "https://example.com/a")!).absoluteString, "https://example.com/a")
        XCTAssertTrue(HTMLMetadataExtractor.isHTML(nil))
        XCTAssertTrue(HTMLMetadataExtractor.isHTML("application/xhtml+xml; charset=utf-8"))
        XCTAssertFalse(HTMLMetadataExtractor.isHTML("image/jpeg"))
    }
}
