import XCTest
#if canImport(Stash)
@testable import Stash
#else
@testable import StashCore
#endif

final class MetadataParserTests: XCTestCase {
    private let articleURL = URL(string: "https://www.nature.com/articles/d41586-026-02943-1")!

    func testReadsOpenGraphJSONLDAndCanonical() {
        let html = """
        <!DOCTYPE html><html lang="en"><head>
        <meta charset="utf-8">
        <title>How to make a brain: new experiments challenge existing picture | Nature</title>
        <meta property="og:title" content="How to make a brain: new experiments challenge existing picture">
        <meta property="og:description" content="Scientists &amp; their &#8220;mini-brains&#8221;.">
        <meta property="og:image" content="/images/brain.jpg">
        <meta property="og:site_name" content="Nature">
        <meta name="citation_author" content="Peeples, Lynne">
        <meta name="citation_publication_date" content="2026/09/18">
        <link rel="canonical" href="https://www.nature.com/articles/d41586-026-02943-1">
        <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Nature"},
        {"@type":"NewsArticle","headline":"JSON headline","author":[{"@type":"Person","name":"Lynne Peeples"}],
        "datePublished":"2026-09-18T23:30:00-04:00","publisher":{"@type":"Organization","name":"Nature Publishing Group"}}]}</script>
        </head><body><svg><title>icon</title></svg><p>body text is never read into details</p></body></html>
        """
        let page = HTMLMetadataParser.parse(html, baseURL: articleURL)
        XCTAssertFalse(page.isInterstitial)
        XCTAssertEqual(page.metadata, LinkMetadata(
            title: "How to make a brain: new experiments challenge existing picture",
            summary: "Scientists & their “mini-brains”.",
            imageURL: "https://www.nature.com/images/brain.jpg",
            siteName: "Nature",
            author: "Lynne Peeples",
            publishedDate: "2026-09-18",
            canonicalURL: "https://www.nature.com/articles/d41586-026-02943-1"))
    }

    func testToleratesMessyMarkup() {
        let html = """
        <HTML><HEAD><Title>Plain &amp; simple</Title>
        <!-- <meta property="og:title" content="commented out"> -->
        <script>var s = "<meta property='og:title' content='inside a script'>";</script>
        <META NAME=description CONTENT=unquoted>
        <meta content='Single &quot;quoted&quot;' property='og:site_name'/>
        <meta name="author" content="https://facebook.com/someone">
        <meta name="citation_author" content="Doe, Jane">
        <base href="https://cdn.example.com/assets/">
        <meta property="og:image" content="img/cover.png">
        </HEAD><body><meta property="og:title" content="late but fine"></body></HTML>
        """
        let metadata = HTMLMetadataParser.parse(html, baseURL: URL(string: "https://example.com/post")!).metadata
        XCTAssertEqual(metadata.title, "late but fine")
        XCTAssertEqual(metadata.summary, "unquoted")
        XCTAssertEqual(metadata.siteName, "Single \"quoted\"")
        XCTAssertEqual(metadata.author, "Jane Doe")
        XCTAssertEqual(metadata.imageURL, "https://cdn.example.com/assets/img/cover.png")
    }

    func testFallsBackToDocumentTitleAndDropsUnusableValues() {
        let html = """
        <head><title>
           Only   a title
        </title><meta property="og:image" content="javascript:alert(1)"><meta property="og:title" content="   ">
        <meta name="date" content="sometime"></head>
        """
        let metadata = HTMLMetadataParser.parse(html, baseURL: URL(string: "https://example.com")!).metadata
        XCTAssertEqual(metadata, LinkMetadata(title: "Only a title"))
    }

    func testRecognizesBotChecksAndErrorPages() {
        for title in ["Just a moment...", "Attention Required! | Cloudflare", "Access Denied", "Robot Check", "Checking your browser before accessing example.com"] {
            let page = HTMLMetadataParser.parse("<title>\(title)</title>", baseURL: articleURL)
            XCTAssertTrue(page.isInterstitial, title)
        }
        XCTAssertFalse(HTMLMetadataParser.parse("<title>Just a moment of silence for the old web</title>", baseURL: articleURL).isInterstitial)
    }

    func testDecodesDeclaredAndSniffedCharsets() {
        var latin = Data("<head><meta charset=\"iso-8859-1\"><title>Caf".utf8)
        latin.append(0xE9)
        latin.append(contentsOf: Array("</title>".utf8))
        XCTAssertTrue(HTMLMetadataParser.decode(latin, contentType: "text/html").contains("Café"))
        var windows = Data("<title>".utf8)
        windows.append(contentsOf: [0x93, 0x71, 0x94])
        XCTAssertTrue(HTMLMetadataParser.decode(windows, contentType: "text/html; charset=\"windows-1252\"").contains("“q”"))
        // A multi-byte character cut off at the size limit doesn't lose the rest of the page.
        let cut = Data("<title>Café</title>é".utf8).dropLast()
        XCTAssertTrue(HTMLMetadataParser.decode(Data(cut), contentType: "text/html; charset=utf-8").contains("<title>Café</title>"))
    }

    func testPublicationDatesKeepTheWrittenCalendarDate() {
        XCTAssertEqual(PublicationDate.normalized("2026-09-18T23:30:00-04:00"), "2026-09-18")
        XCTAssertEqual(PublicationDate.normalized("2026/09/18"), "2026-09-18")
        XCTAssertEqual(PublicationDate.normalized(" 2026-09-18 "), "2026-09-18")
        XCTAssertNil(PublicationDate.normalized("2026-13-01"))
        XCTAssertNil(PublicationDate.normalized("20260918"))
        XCTAssertNil(PublicationDate.normalized("2026-09-180"))
        XCTAssertEqual(PublicationDate.display("2026-09-18", locale: Locale(identifier: "en_US")), "Sep 18, 2026")
    }
}

final class SavedItemRecordTests: XCTestCase {
    private let savedAt = Date(timeIntervalSince1970: 1_790_000_000)

    func testRefreshOnlyFillsFieldsTheUserHasNotEdited() throws {
        var record = SavedItemRecord(link: try WebLink("https://example.com/a"), savedAt: savedAt, origin: .app)
        XCTAssertEqual(record.title, "example.com/a")
        XCTAssertFalse(record.hasTitle)
        record.applyMetadata(LinkMetadata(title: "Page title", summary: "About the page"), at: savedAt)
        XCTAssertEqual(record.title, "Page title")
        XCTAssertTrue(record.rename("My title", now: savedAt))
        record.applyMetadata(LinkMetadata(title: "Changed page title", siteName: "Example"), at: savedAt)
        XCTAssertEqual(record.title, "My title")
        XCTAssertEqual(record.page.title, "Changed page title")
        XCTAssertEqual(record.page.summary, "About the page", "a blank field in a refresh erases nothing")
        XCTAssertEqual(record.source, "Example")
        XCTAssertEqual(record.url, "https://example.com/a")
        XCTAssertTrue(record.rename("   ", now: savedAt))
        XCTAssertEqual(record.title, "Changed page title")
        XCTAssertFalse(record.rename("Changed page title", now: savedAt), "typing the page's own title isn't an edit")
    }

    func testSeedKeepsItsArchiveLinkAndKnownDetailsThroughRefreshes() throws {
        var record = try XCTUnwrap(Seed.record(at: savedAt))
        XCTAssertEqual(record.url, "https://archive.ph/GDsbC")
        XCTAssertEqual(record.origin, .seed)
        record.applyMetadata(LinkMetadata(title: "archive.ph", summary: "Archived copy", imageURL: "https://archive.ph/GDsbC/scr.png",
                                          siteName: "archive.ph", author: " ", publishedDate: "2020-01-01",
                                          canonicalURL: "https://archive.ph/GDsbC"), at: savedAt)
        record.applyMetadata(LinkMetadata(), at: savedAt)
        XCTAssertEqual(record.url, "https://archive.ph/GDsbC")
        XCTAssertEqual(record.title, "How to make a brain: new experiments challenge existing picture")
        XCTAssertEqual(record.source, "Nature")
        XCTAssertEqual(record.author, "Lynne Peeples")
        XCTAssertEqual(record.publishedDate, "2026-09-18")
        XCTAssertEqual(record.originalURL, "https://www.nature.com/articles/d41586-026-02943-1")
        XCTAssertEqual(record.page.summary, "Archived copy")
        XCTAssertEqual(record.host, "archive.ph")
    }

    func testRepeatSavesOnlyMoveForward() throws {
        var record = SavedItemRecord(link: try WebLink("https://example.com/a"), savedAt: savedAt, origin: .share)
        XCTAssertFalse(record.recordSave(at: savedAt, now: savedAt))
        XCTAssertFalse(record.recordSave(at: savedAt.addingTimeInterval(-60), now: savedAt))
        XCTAssertTrue(record.recordSave(at: savedAt.addingTimeInterval(60), now: savedAt.addingTimeInterval(60)))
        XCTAssertEqual(record.lastSavedAt, savedAt.addingTimeInterval(60))
        XCTAssertEqual(record.createdAt, savedAt)
    }

    func testAutomaticRetriesAreLimitedToTransientFailures() throws {
        var record = SavedItemRecord(link: try WebLink("https://example.com/a"), savedAt: savedAt, origin: .app)
        XCTAssertTrue(record.wantsAutomaticMetadata)
        for _ in 0..<5 { record.recordMetadataFailure(.offline, at: savedAt) }
        XCTAssertEqual(record.metadataAttempts, 0, "offline attempts don't use up retries")
        XCTAssertTrue(record.wantsAutomaticMetadata)
        for _ in 0..<SavedItemRecord.automaticAttemptLimit { record.recordMetadataFailure(.timedOut, at: savedAt) }
        XCTAssertFalse(record.wantsAutomaticMetadata)
        var blocked = SavedItemRecord(link: try WebLink("https://example.com/b"), savedAt: savedAt, origin: .app)
        blocked.recordMetadataFailure(.blocked, at: savedAt)
        XCTAssertFalse(blocked.wantsAutomaticMetadata)
        XCTAssertEqual(blocked.title, "example.com/b", "a failed fetch still leaves a readable title")
        blocked.applyMetadata(LinkMetadata(), at: savedAt)
        XCTAssertFalse(blocked.wantsAutomaticMetadata)
        XCTAssertNil(blocked.metadataFailure)
    }

    func testSearchCoversTitleSourceDomainAndLink() throws {
        var record = try XCTUnwrap(Seed.record(at: savedAt))
        XCTAssertTrue(record.matches(""))
        XCTAssertTrue(record.matches("brain NATURE"))
        XCTAssertTrue(record.matches("archive.ph"))
        XCTAssertTrue(record.matches("GDsbC"))
        XCTAssertFalse(record.matches("brain cafe"))
        XCTAssertTrue(record.rename("Café notes", now: savedAt))
        XCTAssertTrue(record.matches("cafe"))
        XCTAssertTrue(record.matches("experiments"), "the automatic title stays searchable after a rename")
    }

    func testFailureReasonsFromNetworkErrors() {
        XCTAssertEqual(MetadataFailure(URLError(.notConnectedToInternet)), .offline)
        XCTAssertEqual(MetadataFailure(URLError(.timedOut)), .timedOut)
        XCTAssertEqual(MetadataFailure(URLError(.cannotFindHost)), .unreachable)
        XCTAssertEqual(MetadataFailure(httpStatus: 403), .blocked)
        XCTAssertEqual(MetadataFailure(httpStatus: 429), .blocked)
        XCTAssertEqual(MetadataFailure(httpStatus: 404), .notFound)
        XCTAssertEqual(MetadataFailure(httpStatus: 503), .serverError)
    }
}
