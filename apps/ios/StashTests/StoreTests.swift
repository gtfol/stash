import XCTest
import SwiftData
@testable import Stash

final class StoreTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_790_000_000)

    private func freshDefaults() -> UserDefaults {
        let name = "stash-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        addTeardownBlock { UserDefaults().removePersistentDomain(forName: name) }
        return defaults
    }

    private func temporaryDirectory() -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("stash-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory
    }

    @MainActor func testSavingTheSamePageAgainKeepsOneItemAndTheFirstLink() throws {
        let container = try SavedItemStore.makeInMemoryContainer()
        let store = SavedItemStore(context: container.mainContext, defaults: freshDefaults())
        let first = try store.save(WebLink("https://example.com/a?utm_source=news"), origin: .app, at: t0)
        let again = try store.save(WebLink("https://www.example.com/a/"), origin: .share, at: t0.addingTimeInterval(60))
        guard case .added(let id) = first else { return XCTFail("\(first)") }
        XCTAssertEqual(again, .alreadySaved(id))
        let items = try store.allItems()
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].url, "https://example.com/a?utm_source=news")
        XCTAssertEqual(items[0].lastSavedAt, t0.addingTimeInterval(60))
        XCTAssertEqual(items[0].createdAt, t0)
    }

    @MainActor func testSavedLinkSurvivesReopeningTheStore() throws {
        let directory = temporaryDirectory()
        let defaults = freshDefaults()
        do {
            let container = try SavedItemStore.makeContainer(in: directory)
            let store = SavedItemStore(context: container.mainContext, defaults: defaults)
            try store.save(WebLink("https://example.com/kept"), origin: .app, at: t0)
            try store.recordMetadataFailure(.offline, for: XCTUnwrap(store.allItems().first).id, now: t0)
        }
        let reopened = try SavedItemStore.makeContainer(in: directory)
        let items = try SavedItemStore(context: reopened.mainContext, defaults: defaults).allItems()
        XCTAssertEqual(items.map(\.url), ["https://example.com/kept"])
        XCTAssertEqual(items.first?.record.title, "example.com/kept")
        XCTAssertEqual(items.first?.record.metadataFailure, .offline)
    }

    @MainActor func testFirstLaunchArticleIsAddedOnceAndStaysDeleted() throws {
        let defaults = freshDefaults()
        let container = try SavedItemStore.makeInMemoryContainer()
        let store = SavedItemStore(context: container.mainContext, defaults: defaults)
        XCTAssertTrue(try store.seedIfNeeded(now: t0))
        let seeded = try XCTUnwrap(store.allItems().first).record
        XCTAssertEqual(seeded.url, "https://archive.ph/GDsbC")
        XCTAssertEqual(seeded.title, "How to make a brain: new experiments challenge existing picture")
        XCTAssertEqual(seeded.source, "Nature")
        XCTAssertEqual(seeded.author, "Lynne Peeples")
        XCTAssertEqual(seeded.publishedDate, "2026-09-18")
        XCTAssertEqual(seeded.originalURL, "https://www.nature.com/articles/d41586-026-02943-1")

        XCTAssertFalse(try store.seedIfNeeded(now: t0), "relaunch")
        XCTAssertEqual(try store.allItems().count, 1)
        try store.delete(id: seeded.id)
        XCTAssertFalse(try store.seedIfNeeded(now: t0), "relaunch after deleting")
        XCTAssertTrue(try store.allItems().isEmpty)

        let replacement = try SavedItemStore.makeInMemoryContainer()
        XCTAssertFalse(try SavedItemStore(context: replacement.mainContext, defaults: defaults).seedIfNeeded(now: t0),
                       "a new or migrated store doesn't bring it back")
    }

    @MainActor func testFirstLaunchArticleIsNotDuplicatedWhenAlreadySaved() throws {
        let defaults = freshDefaults()
        let container = try SavedItemStore.makeInMemoryContainer()
        let store = SavedItemStore(context: container.mainContext, defaults: defaults)
        try store.save(WebLink("https://www.nature.com/articles/d41586-026-02943-1"), origin: .app, at: t0)
        XCTAssertFalse(try store.seedIfNeeded(now: t0))
        XCTAssertEqual(try store.allItems().count, 1)
        XCTAssertTrue(defaults.bool(forKey: Seed.defaultsKey))
    }

    @MainActor func testMetadataNeverReplacesTheSeedsKnownDetailsOrLink() throws {
        let container = try SavedItemStore.makeInMemoryContainer()
        let store = SavedItemStore(context: container.mainContext, defaults: freshDefaults())
        try store.seedIfNeeded(now: t0)
        let id = try XCTUnwrap(store.allItems().first).id
        try store.applyMetadata(LinkMetadata(title: "archive.ph", summary: "Archived copy", siteName: "archive.ph", author: "",
                                             canonicalURL: "https://archive.ph/other"), to: id, now: t0)
        let record = try XCTUnwrap(store.item(id: id)).record
        XCTAssertEqual(record.url, "https://archive.ph/GDsbC")
        XCTAssertEqual(record.title, "How to make a brain: new experiments challenge existing picture")
        XCTAssertEqual(record.source, "Nature")
        XCTAssertEqual(record.author, "Lynne Peeples")
        XCTAssertEqual(record.page.summary, "Archived copy")
        XCTAssertEqual(record.metadataStatus, .fetched)
    }

    @MainActor func testMetadataFillsOnlyFieldsTheUserHasNotEdited() throws {
        let container = try SavedItemStore.makeInMemoryContainer()
        let store = SavedItemStore(context: container.mainContext, defaults: freshDefaults())
        let id = try store.save(WebLink("https://example.com/story"), origin: .app, at: t0).id
        XCTAssertEqual(try store.itemsWantingMetadata().map(\.id), [id])
        try store.rename(id: id, to: "my name for it")
        try store.applyMetadata(LinkMetadata(title: "Site title", summary: "Summary", imageURL: "https://example.com/i.jpg"), to: id)
        let record = try XCTUnwrap(store.item(id: id)).record
        XCTAssertEqual(record.title, "my name for it")
        XCTAssertEqual(record.page.title, "Site title")
        XCTAssertEqual(record.page.imageURL, "https://example.com/i.jpg")
        XCTAssertTrue(try store.itemsWantingMetadata().isEmpty)
    }

    @MainActor func testInboxImportAddsEachPageOnceAndIsSafeToRepeat() throws {
        let inbox = ShareInbox(directory: temporaryDirectory())
        let container = try SavedItemStore.makeInMemoryContainer()
        let store = SavedItemStore(context: container.mainContext, defaults: freshDefaults())
        let shared = try WebLink("https://example.com/shared")
        let recordID = UUID()
        try inbox.enqueue(shared, sharedAt: t0, id: recordID)
        try inbox.enqueue(WebLink("https://example.com/shared?utm_source=twitter"), sharedAt: t0.addingTimeInterval(5))
        try inbox.enqueue(WebLink("https://example.com/other"), sharedAt: t0.addingTimeInterval(10))

        XCTAssertEqual(try store.importInbox(inbox, now: t0), .init(added: 2, alreadySaved: 1))
        XCTAssertTrue(try inbox.contents().entries.isEmpty, "records are removed after the save")
        let items = try store.allItems()
        XCTAssertEqual(items.map(\.url), ["https://example.com/other", "https://example.com/shared"])
        XCTAssertEqual(items[1].lastSavedAt, t0.addingTimeInterval(5))
        XCTAssertEqual(items[1].origin, "share")

        // The app was stopped after saving but before removing a record: it comes back unchanged.
        try inbox.enqueue(shared, sharedAt: t0, id: recordID)
        XCTAssertEqual(try store.importInbox(inbox, now: t0.addingTimeInterval(60)), .init(added: 0, alreadySaved: 1))
        let again = try store.allItems()
        XCTAssertEqual(again.count, 2)
        XCTAssertEqual(again[1].lastSavedAt, t0.addingTimeInterval(5))
        XCTAssertTrue(try inbox.contents().entries.isEmpty)
    }

    @MainActor func testImportSetsAsideRecordsItCannotUse() throws {
        let inbox = ShareInbox(directory: temporaryDirectory())
        try FileManager.default.createDirectory(at: inbox.directory, withIntermediateDirectories: true)
        try Data(#"{"version":1,"id":"\#(UUID().uuidString)","url":"ftp://example.com/x","sharedAt":1000}"#.utf8)
            .write(to: inbox.directory.appendingPathComponent("0001-bad.json"))
        try Data("{".utf8).write(to: inbox.directory.appendingPathComponent("0002-broken.json"))
        try inbox.enqueue(WebLink("https://example.com/fine"), sharedAt: t0)
        let container = try SavedItemStore.makeInMemoryContainer()
        let store = SavedItemStore(context: container.mainContext, defaults: freshDefaults())
        XCTAssertEqual(try store.importInbox(inbox, now: t0), .init(added: 1, alreadySaved: 0, setAside: 2))
        XCTAssertEqual(try store.allItems().map(\.url), ["https://example.com/fine"])
        XCTAssertTrue(try inbox.contents().entries.isEmpty)
        XCTAssertTrue(try inbox.contents().unreadable.isEmpty)
    }

    @MainActor func testRenameAndDelete() throws {
        let container = try SavedItemStore.makeInMemoryContainer()
        let store = SavedItemStore(context: container.mainContext, defaults: freshDefaults())
        let id = try store.save(WebLink("https://example.com/a"), origin: .app).id
        try store.rename(id: id, to: "  a better   name ")
        XCTAssertEqual(try store.item(id: id)?.customTitle, "a better name")
        try store.rename(id: id, to: "")
        XCTAssertNil(try store.item(id: id)?.customTitle)
        try store.delete(id: id)
        XCTAssertNil(try store.item(id: id))
        XCTAssertNoThrow(try store.delete(id: id))
    }
}
