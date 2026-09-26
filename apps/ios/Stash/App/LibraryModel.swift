import Foundation
import Network
import Observation
import SwiftUI

/// What the library screen does: save links, bring in shares, edit, and keep details fresh. The
/// items themselves are read by the views through SwiftData's @Query.
@MainActor @Observable final class LibraryModel {
    struct Notice: Equatable {
        enum Kind { case saved, alreadySaved, info, problem }
        var kind: Kind
        var text: String
    }

    /// Asks the list to show an item after a save, even when it's the same item again.
    struct FocusRequest: Equatable {
        let itemID: UUID
        let token = UUID()
    }

    private(set) var notice: Notice?
    private(set) var isOnline = true
    private(set) var focusRequest: FocusRequest?
    let refresher: MetadataRefresher
    let store: SavedItemStore

    private let inbox: ShareInbox?
    @ObservationIgnored private var noticeTask: Task<Void, Never>?
    @ObservationIgnored private var connectivityTask: Task<Void, Never>?
    @ObservationIgnored private var monitor: NWPathMonitor?
    @ObservationIgnored private var started = false

    init(store: SavedItemStore, inbox: ShareInbox?, extractor: any LinkMetadataExtractor) {
        self.store = store
        self.inbox = inbox
        refresher = MetadataRefresher(store: store, extractor: extractor)
    }

    /// Share extension records can only arrive when the App Group is set up for both targets.
    var canReceiveShares: Bool { inbox != nil }

    func start() {
        guard !started else { return }
        started = true
        do { try store.seedIfNeeded() } catch { show(.problem, "your library couldn’t be updated. try reopening stash.") }
        watchConnectivity()
        becameActive()
    }

    func becameActive() {
        importShares()
        refresher.refreshWaitingItems()
    }

    /// Unfinished fetches are cancelled rather than left to fail while suspended; they resume
    /// next time stash is opened.
    func enteredBackground() {
        refresher.cancelAll()
    }

    // MARK: Saving

    /// Saves text typed into the add field. Throws `LinkError` for anything that isn't one web link.
    func save(typed text: String) throws {
        try save(WebLink.typed(text))
    }

    func paste(_ providers: [NSItemProvider]) async {
        let contents = await SharedPayload.contents(of: providers)
        do {
            try save(SharedPayload.link(in: contents))
        } catch let error as LinkError {
            show(.problem, error.localizedDescription)
        } catch {
            show(.problem, "couldn’t save this link. try again.")
        }
    }

    private func save(_ link: WebLink) throws {
        let result: SavedItemStore.SaveResult
        do { result = try store.save(link, origin: .app) } catch { throw SaveError.storage }
        focusRequest = FocusRequest(itemID: result.id)
        switch result {
        case .added(let id):
            show(.saved, isOnline ? "saved." : "saved. details will load when you’re back online.")
            if let record = try? store.item(id: id)?.record { refresher.refresh(record) }
        case .alreadySaved:
            show(.alreadySaved, "already saved. moved to the top.")
        }
    }

    enum SaveError: LocalizedError {
        case storage
        var errorDescription: String? { "couldn’t save this link. try again." }
    }

    func importShares() {
        guard let inbox else { return }
        do {
            let report = try store.importInbox(inbox)
            if report.added > 0 {
                show(.info, report.added == 1 ? "added 1 shared link." : "added \(report.added) shared links.")
            }
            if report.setAside > 0 {
                show(.problem, report.setAside == 1 ? "1 shared link couldn’t be read." : "\(report.setAside) shared links couldn’t be read.")
            }
        } catch {
            show(.problem, "couldn’t bring in shared links. they’ll be tried again.")
        }
    }

    // MARK: Editing

    func rename(_ id: UUID, to title: String) {
        do { try store.rename(id: id, to: title) } catch { show(.problem, "couldn’t rename this link. try again.") }
    }

    func delete(_ id: UUID) {
        refresher.cancel(id)
        do { try store.delete(id: id) } catch { show(.problem, "couldn’t delete this link. try again.") }
    }

    func refreshDetails(_ record: SavedItemRecord) {
        refresher.refresh(record)
    }

    func copyLink(_ record: SavedItemRecord) {
        UIPasteboard.general.string = record.url
        show(.info, "link copied.")
    }

    // MARK: Notices

    func show(_ kind: Notice.Kind, _ text: String) {
        notice = Notice(kind: kind, text: text)
        AccessibilityNotification.Announcement(text).post()
        noticeTask?.cancel()
        noticeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(kind == .problem ? 6 : 3))
            guard !Task.isCancelled else { return }
            self?.notice = nil
        }
    }

    func dismissNotice() {
        noticeTask?.cancel()
        notice = nil
    }

    // MARK: Connectivity

    private func watchConnectivity() {
        let (updates, continuation) = AsyncStream.makeStream(of: Bool.self, bufferingPolicy: .bufferingNewest(1))
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { @Sendable path in continuation.yield(path.status == .satisfied) }
        monitor.start(queue: DispatchQueue(label: "stash.connectivity"))
        self.monitor = monitor
        connectivityTask = Task { [weak self] in
            for await online in updates {
                self?.connectivityChanged(online)
            }
        }
    }

    private func connectivityChanged(_ online: Bool) {
        let returned = online && !isOnline
        isOnline = online
        if returned { refresher.refreshWaitingItems() }
    }
}
