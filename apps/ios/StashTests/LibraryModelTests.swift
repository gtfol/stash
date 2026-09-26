import XCTest
import SwiftData
@testable import Stash

/// Holds every fetch until released, so a test can look at the library in between.
actor GatedExtractor: LinkMetadataExtractor {
    private let result: Result<LinkMetadata, MetadataFailure>
    private var released = false
    private var waiting: [CheckedContinuation<Void, Never>] = []
    private(set) var requests: [URL] = []

    init(_ result: Result<LinkMetadata, MetadataFailure>) { self.result = result }

    func metadata(for url: URL) async throws -> LinkMetadata {
        requests.append(url)
        if !released { await withCheckedContinuation { waiting.append($0) } }
        return try result.get()
    }

    func release() {
        released = true
        waiting.forEach { $0.resume() }
        waiting.removeAll()
    }
}

final class LibraryModelTests: XCTestCase {
    @MainActor private func makeModel(_ extractor: any LinkMetadataExtractor, inbox: ShareInbox? = nil) throws -> (ModelContainer, LibraryModel) {
        let container = try SavedItemStore.makeInMemoryContainer()
        let name = "stash-model-tests-\(UUID().uuidString)"
        addTeardownBlock { UserDefaults().removePersistentDomain(forName: name) }
        let store = SavedItemStore(context: container.mainContext, defaults: UserDefaults(suiteName: name)!)
        return (container, LibraryModel(store: store, inbox: inbox, extractor: extractor))
    }

    @MainActor private func settle(_ model: LibraryModel) async throws {
        for _ in 0..<200 where !model.refresher.fetching.isEmpty { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertTrue(model.refresher.fetching.isEmpty)
    }

    @MainActor func testTypedLinkIsSavedBeforeDetailsArrive() async throws {
        let extractor = GatedExtractor(.success(LinkMetadata(title: "A page", siteName: "Example")))
        let (container, model) = try makeModel(extractor)
        try model.save(typed: "example.com/story")
        let saved = try XCTUnwrap(model.store.allItems().first).record
        XCTAssertEqual(saved.url, "https://example.com/story")
        XCTAssertEqual(saved.title, "example.com/story")
        XCTAssertEqual(saved.metadataStatus, .pending)
        XCTAssertTrue(model.refresher.fetching.contains(saved.id))
        XCTAssertEqual(model.notice?.kind, .saved)
        XCTAssertEqual(model.focusRequest?.itemID, saved.id)

        await extractor.release()
        try await settle(model)
        let filled = try XCTUnwrap(model.store.item(id: saved.id)).record
        XCTAssertEqual(filled.title, "A page")
        XCTAssertEqual(filled.source, "Example")
        XCTAssertEqual(filled.url, "https://example.com/story")
        withExtendedLifetime(container) {}
    }

    @MainActor func testBlockedDetailsLeaveAReadableItemThatIsNotRetriedAutomatically() async throws {
        let extractor = GatedExtractor(.failure(.blocked))
        await extractor.release()
        let (container, model) = try makeModel(extractor)
        try model.save(typed: "https://example.com/blocked")
        try await settle(model)
        let record = try XCTUnwrap(model.store.allItems().first).record
        XCTAssertEqual(record.title, "example.com/blocked")
        XCTAssertEqual(record.metadataFailure, .blocked)
        model.becameActive()
        XCTAssertTrue(model.refresher.fetching.isEmpty)
        let requests = await extractor.requests
        XCTAssertEqual(requests.map(\.absoluteString), ["https://example.com/blocked"])
        withExtendedLifetime(container) {}
    }

    @MainActor func testRejectedInputSavesNothing() async throws {
        let (container, model) = try makeModel(GatedExtractor(.success(LinkMetadata())))
        XCTAssertThrowsError(try model.save(typed: "mailto:someone@example.com")) {
            XCTAssertEqual($0 as? LinkError, .unsupportedScheme("mailto"))
        }
        await model.paste([NSItemProvider(object: "nothing to see here" as NSString)])
        XCTAssertEqual(model.notice, LibraryModel.Notice(kind: .problem, text: "no link found. nothing was saved."))
        XCTAssertTrue(try model.store.allItems().isEmpty)
        withExtendedLifetime(container) {}
    }

    @MainActor func testSharesAreImportedWhenStashBecomesActive() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("stash-model-inbox-\(UUID().uuidString)")
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let inbox = ShareInbox(directory: directory)
        try inbox.enqueue(WebLink("https://example.com/shared"))
        let extractor = GatedExtractor(.success(LinkMetadata(title: "Shared page")))
        let (container, model) = try makeModel(extractor, inbox: inbox)
        model.becameActive()
        XCTAssertEqual(try model.store.allItems().map(\.url), ["https://example.com/shared"])
        XCTAssertEqual(model.notice?.text, "added 1 shared link.")
        XCTAssertTrue(try inbox.contents().entries.isEmpty)
        await extractor.release()
        try await settle(model)
        XCTAssertEqual(try model.store.allItems().first?.record.title, "Shared page")
        withExtendedLifetime(container) {}
    }
}
