import Foundation
import Observation

/// Fetches page details a few at a time, after the link is already saved. Results go through
/// `SavedItemStore`, which only writes the page layer. Cancelled work records nothing, so the item
/// stays pending and is tried again later.
@MainActor @Observable final class MetadataRefresher {
    /// Items with a fetch queued or running, for "fetching details…".
    private(set) var fetching: Set<UUID> = []

    private let store: SavedItemStore
    private let extractor: any LinkMetadataExtractor
    @ObservationIgnored private var running: [UUID: (token: UUID, task: Task<Void, Never>)] = [:]
    @ObservationIgnored private var waiting: [(id: UUID, url: URL)] = []
    private let concurrency = 3

    private enum Outcome: Sendable {
        case fetched(LinkMetadata)
        case failed(MetadataFailure)
        case cancelled
    }

    init(store: SavedItemStore, extractor: any LinkMetadataExtractor) {
        self.store = store
        self.extractor = extractor
    }

    /// New items and transient failures (see `SavedItemRecord.wantsAutomaticMetadata`).
    func refreshWaitingItems() {
        guard let records = try? store.itemsWantingMetadata() else { return }
        for record in records { refresh(record) }
    }

    func refresh(_ record: SavedItemRecord) {
        guard !fetching.contains(record.id), let url = URL(string: record.url) else { return }
        fetching.insert(record.id)
        waiting.append((record.id, url))
        startWaiting()
    }

    func cancel(_ id: UUID) {
        running.removeValue(forKey: id)?.task.cancel()
        waiting.removeAll { $0.id == id }
        fetching.remove(id)
    }

    func cancelAll() {
        for id in fetching { cancel(id) }
    }

    private func startWaiting() {
        while running.count < concurrency, !waiting.isEmpty {
            let (id, url) = waiting.removeFirst()
            let token = UUID()
            let extractor = extractor
            let task = Task { [weak self] in
                let outcome: Outcome
                do {
                    outcome = .fetched(try await extractor.metadata(for: url))
                } catch {
                    let cancelled = Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled
                    outcome = cancelled ? .cancelled : .failed(MetadataFailure(error))
                }
                self?.finish(id, token: token, outcome: outcome)
            }
            running[id] = (token, task)
        }
    }

    private func finish(_ id: UUID, token: UUID, outcome: Outcome) {
        guard running[id]?.token == token else { return startWaiting() }
        running[id] = nil
        fetching.remove(id)
        switch outcome {
        case .fetched(let metadata): try? store.applyMetadata(metadata, to: id)
        case .failed(let failure): try? store.recordMetadataFailure(failure, for: id)
        case .cancelled: break
        }
        startWaiting()
    }
}
