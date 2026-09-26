import XCTest
#if canImport(Stash)
@testable import Stash
#else
@testable import StashCore
#endif

final class ShareInboxTests: XCTestCase {
    private func makeInbox() -> ShareInbox {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("stash-inbox-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return ShareInbox(directory: directory)
    }

    func testEachShareIsOneCompleteUniquelyNamedRecord() throws {
        let inbox = makeInbox()
        let link = try WebLink("https://example.com/a")
        let first = try inbox.enqueue(link, sharedAt: Date(timeIntervalSince1970: 1_000.25))
        let second = try inbox.enqueue(link, sharedAt: Date(timeIntervalSince1970: 1_001))
        let contents = try inbox.contents()
        XCTAssertEqual(contents.entries.map(\.record), [first, second])
        XCTAssertEqual(first.url, "https://example.com/a")
        XCTAssertEqual(first.sharedAt, Date(timeIntervalSince1970: 1_000.25))
        XCTAssertNotEqual(first.id, second.id)
        let names = try FileManager.default.contentsOfDirectory(atPath: inbox.directory.path)
        XCTAssertEqual(names.count, 2)
        XCTAssertTrue(names.allSatisfy { $0.hasSuffix(".json") && !$0.hasPrefix(".") }, "\(names)")
    }

    func testPartialFilesAreIgnoredAndBrokenRecordsSetAside() throws {
        let inbox = makeInbox()
        try inbox.enqueue(WebLink("https://example.com/a"))
        try Data(#"{"url":"#.utf8).write(to: inbox.directory.appendingPathComponent(".abc.json.partial"))
        try Data("not json".utf8).write(to: inbox.directory.appendingPathComponent("0000-broken.json"))
        let contents = try inbox.contents()
        XCTAssertEqual(contents.entries.count, 1)
        XCTAssertEqual(contents.unreadable.map(\.lastPathComponent), ["0000-broken.json"])
        inbox.setAside(contents.unreadable[0])
        XCTAssertTrue(try inbox.contents().unreadable.isEmpty)
        XCTAssertEqual(try inbox.contents().entries.count, 1)
    }

    func testRecordsFromANewerVersionWaitForANewerApp() throws {
        let inbox = makeInbox()
        try FileManager.default.createDirectory(at: inbox.directory, withIntermediateDirectories: true)
        let file = inbox.directory.appendingPathComponent("0001-future.json")
        try Data(#"{"version":2,"id":"\#(UUID().uuidString)","url":"https://example.com","sharedAt":1000}"#.utf8).write(to: file)
        let contents = try inbox.contents()
        XCTAssertTrue(contents.entries.isEmpty)
        XCTAssertTrue(contents.unreadable.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
    }

    func testAbandonedPartialsAreRemovedOnlyWhenStale() throws {
        let inbox = makeInbox()
        try inbox.enqueue(WebLink("https://example.com/a"))
        let partial = inbox.directory.appendingPathComponent(".x.json.partial")
        try Data().write(to: partial)
        inbox.removeAbandonedPartials(now: Date())
        XCTAssertTrue(FileManager.default.fileExists(atPath: partial.path))
        inbox.removeAbandonedPartials(now: Date().addingTimeInterval(3_600))
        XCTAssertFalse(FileManager.default.fileExists(atPath: partial.path))
        XCTAssertEqual(try inbox.contents().entries.count, 1)
    }

    func testRemovingARecordTwiceIsHarmless() throws {
        let inbox = makeInbox()
        try inbox.enqueue(WebLink("https://example.com/a"))
        let entry = try XCTUnwrap(inbox.contents().entries.first)
        try inbox.remove(entry)
        XCTAssertNoThrow(try inbox.remove(entry))
        XCTAssertTrue(try inbox.contents().entries.isEmpty)
    }

    func testMissingInboxIsEmpty() throws {
        XCTAssertTrue(try makeInbox().contents().entries.isEmpty)
    }
}
