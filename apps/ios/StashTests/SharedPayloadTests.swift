import XCTest
#if canImport(Stash)
@testable import Stash
#else
@testable import StashCore
#endif

final class SharedPayloadTests: XCTestCase {
    func testURLItemsWinOverText() throws {
        let contents = SharedPayload.Contents(urls: ["https://example.com/story"], texts: ["great read https://other.com/x"])
        XCTAssertEqual(try SharedPayload.link(in: contents).string, "https://example.com/story")
    }

    func testTextWithExactlyOneLink() throws {
        let contents = SharedPayload.Contents(texts: ["Look at this 👀 https://example.com/a?id=1 — so good"])
        XCTAssertEqual(try SharedPayload.link(in: contents).string, "https://example.com/a?id=1")
    }

    func testSamePageFromSeveralItemsIsOneLink() throws {
        let contents = SharedPayload.Contents(urls: ["https://example.com/a", "https://example.com/a?utm_medium=social"])
        XCTAssertEqual(try SharedPayload.link(in: contents).string, "https://example.com/a")
    }

    func testNothingIsGuessedWithoutOneWebLink() {
        let cases: [(SharedPayload.Contents, LinkError)] = [
            (.init(texts: ["no link here"]), .noLink),
            (.init(), .noLink),
            (.init(texts: ["https://news.com/1 https://blog.org/2"]), .multipleLinks),
            (.init(urls: ["https://news.com/1", "https://blog.org/2"]), .multipleLinks),
            (.init(urls: ["file:///private/var/mobile/report.pdf"]), .unsupportedScheme("file")),
            (.init(urls: ["mailto:someone@example.com"], texts: ["write to me"]), .unsupportedScheme("mailto"))
        ]
        for (contents, error) in cases {
            XCTAssertThrowsError(try SharedPayload.link(in: contents), "\(contents)") { XCTAssertEqual($0 as? LinkError, error) }
        }
    }

    @MainActor func testReadsURLAndTextItems() async throws {
        let url = NSItemProvider(object: try XCTUnwrap(NSURL(string: "https://example.com/from-safari")))
        let text = NSItemProvider(object: "see https://example.com/from-text" as NSString)
        let contents = await SharedPayload.contents(of: [url, text], extraText: ["page title", ""])
        XCTAssertEqual(contents.urls, ["https://example.com/from-safari"])
        XCTAssertEqual(contents.texts, ["see https://example.com/from-text", "page title"])
        XCTAssertEqual(try SharedPayload.link(in: contents).string, "https://example.com/from-safari")
    }

    @MainActor func testReadsTextOnlyShares() async throws {
        let text = NSItemProvider(object: "https://example.com/only-text" as NSString)
        let contents = await SharedPayload.contents(of: [text])
        XCTAssertEqual(try SharedPayload.link(in: contents).string, "https://example.com/only-text")
    }
}
