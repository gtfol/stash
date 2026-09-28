import XCTest
#if canImport(Stash)
@testable import Stash
#else
@testable import StashCore
#endif

final class WebLinkTests: XCTestCase {
    func testKeepsTheEnteredLinkVerbatim() throws {
        let link = try WebLink("  https://Example.com/Path?b=2&a=1#Section \n")
        XCTAssertEqual(link.string, "https://Example.com/Path?b=2&a=1#Section")
        XCTAssertEqual(link.url.absoluteString, "https://Example.com/Path?b=2&a=1#Section")
        XCTAssertEqual(try WebLink("<https://example.com/a>").string, "https://example.com/a")
        XCTAssertEqual(try WebLink("“https://example.com/a”").string, "https://example.com/a")
        XCTAssertEqual(try WebLink("HTTP://example.com/a").string, "HTTP://example.com/a")
    }

    func testRejectsOtherSchemesByName() {
        let cases = [("ftp://files.example.com/a", "ftp"), ("mailto:someone@example.com", "mailto"), ("javascript:alert(1)", "javascript"),
                     ("file:///etc/hosts", "file"), ("data:text/html,hi", "data"), ("stash://item/1", "stash")]
        for (text, scheme) in cases {
            XCTAssertThrowsError(try WebLink(text), text) { XCTAssertEqual($0 as? LinkError, .unsupportedScheme(scheme), text) }
        }
    }

    func testRejectsMalformedLinks() {
        for text in ["https://", "https:example.com", "http:///path", "https://exa mple.com", "example", "not a link", "//example.com/a"] {
            XCTAssertThrowsError(try WebLink(text), text) { XCTAssertEqual($0 as? LinkError, .invalid, text) }
        }
        XCTAssertThrowsError(try WebLink("  ")) { XCTAssertEqual($0 as? LinkError, .empty) }
        XCTAssertThrowsError(try WebLink("https://example.com/" + String(repeating: "a", count: 9_000))) {
            XCTAssertEqual($0 as? LinkError, .tooLong)
        }
    }

    func testTypedBareDomainGetsHTTPS() throws {
        XCTAssertEqual(try WebLink.typed("example.com/article?id=3").string, "https://example.com/article?id=3")
        XCTAssertEqual(try WebLink.typed("www.example.co.uk").string, "https://www.example.co.uk")
        XCTAssertEqual(try WebLink.typed("example.com:8080/a").string, "https://example.com:8080/a")
        XCTAssertEqual(try WebLink.typed("http://example.com").string, "http://example.com")
        XCTAssertEqual(try WebLink.typed("read this https://example.com/a later").string, "https://example.com/a")
        XCTAssertThrowsError(try WebLink.typed("example")) { XCTAssertEqual($0 as? LinkError, .invalid) }
        XCTAssertThrowsError(try WebLink.typed("ftp://example.com")) { XCTAssertEqual($0 as? LinkError, .unsupportedScheme("ftp")) }
        XCTAssertThrowsError(try WebLink.typed("   ")) { XCTAssertEqual($0 as? LinkError, .empty) }
    }

    func testFindsExactlyOneExplicitLinkInText() throws {
        XCTAssertEqual(try WebLink.found(in: "Check this out: https://example.com/story.").string, "https://example.com/story")
        XCTAssertEqual(try WebLink.found(in: "https://example.com/a and again https://example.com/a?utm_source=x").string,
                       "https://example.com/a")
        XCTAssertThrowsError(try WebLink.found(in: "https://news.com/1 or https://blog.org/2")) {
            XCTAssertEqual($0 as? LinkError, .multipleLinks)
        }
        XCTAssertThrowsError(try WebLink.found(in: "just words, and example.com without a scheme")) {
            XCTAssertEqual($0 as? LinkError, .noLink)
        }
    }

    func testDedupeKeyStripsTrackingAndFragmentsButKeepsMeaningfulParameters() throws {
        let cases = [
            ("https://Example.COM/a?utm_source=x&id=5&fbclid=abc#section", "https://example.com/a?id=5"),
            ("http://www.example.com:80/", "https://example.com/"),
            ("https://example.com", "https://example.com/"),
            ("https://example.com/a/", "https://example.com/a"),
            ("https://example.com:8443/a", "https://example.com:8443/a"),
            ("https://www.youtube.com/watch?v=abc123&si=share&feature=youtu.be", "https://youtube.com/watch?v=abc123"),
            ("https://x.com/user/status/1?s=20&t=abc", "https://x.com/user/status/1"),
            ("https://example.com/?p=42&page=2&q=swift", "https://example.com/?p=42&page=2&q=swift"),
            ("https://news.example.com/story?si=keep", "https://news.example.com/story?si=keep"),
            ("https://app.example.com/#/inbox/3", "https://app.example.com/#/inbox/3"),
            ("https://archive.ph/GDsbC", "https://archive.ph/GDsbC")
        ]
        for (input, key) in cases { XCTAssertEqual(try WebLink(input).dedupeKey, key, input) }
        XCTAssertEqual(try WebLink("http://example.com/a").dedupeKey, try WebLink("https://www.example.com/a/").dedupeKey)
        XCTAssertNotEqual(try WebLink("https://example.com/a?id=1").dedupeKey, try WebLink("https://example.com/a?id=2").dedupeKey)
        XCTAssertNotEqual(try WebLink("https://example.com/A").dedupeKey, try WebLink("https://example.com/a").dedupeKey)
    }

    func testFallbackTitleIsTheReadableLink() {
        XCTAssertEqual(WebLink.fallbackTitle(for: "https://www.example.com/articles/one?id=2"), "example.com/articles/one")
        XCTAssertEqual(WebLink.fallbackTitle(for: "https://archive.ph/GDsbC"), "archive.ph/GDsbC")
        XCTAssertEqual(WebLink.fallbackTitle(for: "https://example.com/"), "example.com")
        XCTAssertEqual(WebLink.displayHost(ofLink: "https://WWW.Nature.com/articles/x"), "nature.com")
    }
}
