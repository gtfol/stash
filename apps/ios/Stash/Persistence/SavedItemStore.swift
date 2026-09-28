import Foundation
import SwiftData

/// The only writer of the library. Every change is saved explicitly and rolled back if the save
/// fails, so the database never keeps a half-applied change.
@MainActor final class SavedItemStore {
    enum SaveResult: Equatable {
        case added(UUID)
        case alreadySaved(UUID)

        var id: UUID {
            switch self {
            case .added(let id), .alreadySaved(let id): id
            }
        }
    }

    struct ImportReport: Equatable {
        var added = 0
        var alreadySaved = 0
        var setAside = 0
    }

    static func makeContainer(in directory: URL) throws -> ModelContainer {
        // Create the folder first so SQLite can open its files on a fresh install.
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let configuration = ModelConfiguration(url: directory.appendingPathComponent("stash.store"), cloudKitDatabase: .none)
        return try ModelContainer(for: SavedItem.self, configurations: configuration)
    }

    static func makeInMemoryContainer() throws -> ModelContainer {
        try ModelContainer(for: SavedItem.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }

    let context: ModelContext
    private let defaults: UserDefaults

    init(context: ModelContext, defaults: UserDefaults = .standard) {
        self.context = context
        self.defaults = defaults
        context.autosaveEnabled = false
    }

    // MARK: Saving

    /// Saves a link, or moves the existing item for the same page to the top. The existing item
    /// keeps its original link, title, and details.
    @discardableResult
    func save(_ link: WebLink, origin: SavedItemRecord.Origin, at date: Date = Date()) throws -> SaveResult {
        do {
            if let existing = try item(dedupeKey: link.dedupeKey) {
                var record = existing.record
                if record.recordSave(at: date, now: date) {
                    existing.apply(record)
                    try context.save()
                }
                return .alreadySaved(existing.id)
            }
            let record = SavedItemRecord(link: link, savedAt: date, origin: origin)
            context.insert(SavedItem(record))
            try context.save()
            return .added(record.id)
        } catch {
            context.rollback()
            throw error
        }
    }

    /// Moves shared links from the App Group inbox into the library. A record is deleted only after
    /// the database save that contains it. If anything stops the import midway, the records stay
    /// and are imported again next time; importing one twice changes nothing.
    @discardableResult
    func importInbox(_ inbox: ShareInbox, now: Date = Date()) throws -> ImportReport {
        let contents = try inbox.contents()
        var report = ImportReport()
        for file in contents.unreadable {
            inbox.setAside(file)
            report.setAside += 1
        }
        var imported: [ShareInbox.Entry] = []
        do {
            for entry in contents.entries {
                guard let link = try? WebLink(entry.record.url) else {
                    inbox.setAside(entry.file)
                    report.setAside += 1
                    continue
                }
                if let existing = try item(dedupeKey: link.dedupeKey) {
                    var record = existing.record
                    if record.recordSave(at: entry.record.sharedAt, now: now) { existing.apply(record) }
                    report.alreadySaved += 1
                } else {
                    context.insert(SavedItem(SavedItemRecord(link: link, savedAt: entry.record.sharedAt, origin: .share)))
                    report.added += 1
                }
                imported.append(entry)
            }
            if context.hasChanges { try context.save() }
        } catch {
            context.rollback()
            throw error
        }
        for entry in imported { try? inbox.remove(entry) }
        inbox.removeAbandonedPartials(now: now)
        return report
    }

    /// Adds the first-launch article once per installation, unless the library already has it.
    @discardableResult
    func seedIfNeeded(now: Date = Date()) throws -> Bool {
        guard !defaults.bool(forKey: Seed.defaultsKey) else { return false }
        var added = false
        let alreadySaved = try Seed.dedupeKeys.contains { try item(dedupeKey: $0) != nil }
        if !alreadySaved, let record = Seed.record(at: now) {
            context.insert(SavedItem(record))
            try commit()
            added = true
        }
        // Marked only after the article is stored, so a failed first save is retried next launch.
        defaults.set(true, forKey: Seed.defaultsKey)
        return added
    }

    // MARK: Editing

    func rename(id: UUID, to title: String, now: Date = Date()) throws {
        guard let item = try item(id: id) else { return }
        var record = item.record
        guard record.rename(title, now: now) else { return }
        item.apply(record)
        try commit()
    }

    func delete(id: UUID) throws {
        guard let item = try item(id: id) else { return }
        context.delete(item)
        try commit()
    }

    // MARK: Metadata

    /// Fetched details only fill the page layer; the link, the user's title, and known details stay.
    func applyMetadata(_ metadata: LinkMetadata, to id: UUID, now: Date = Date()) throws {
        guard let item = try item(id: id) else { return }
        var record = item.record
        record.applyMetadata(metadata, at: now)
        item.apply(record)
        try commit()
    }

    func recordMetadataFailure(_ failure: MetadataFailure, for id: UUID, now: Date = Date()) throws {
        guard let item = try item(id: id) else { return }
        var record = item.record
        record.recordMetadataFailure(failure, at: now)
        item.apply(record)
        try commit()
    }

    /// Items to fetch details for without being asked, most recently saved first.
    func itemsWantingMetadata() throws -> [SavedItemRecord] {
        let fetched = MetadataStatus.fetched.rawValue
        let descriptor = FetchDescriptor<SavedItem>(predicate: #Predicate { $0.metadataStatus != fetched },
                                                    sortBy: [SortDescriptor(\.lastSavedAt, order: .reverse)])
        return try context.fetch(descriptor).map(\.record).filter(\.wantsAutomaticMetadata)
    }

    // MARK: Lookup

    func item(id: UUID) throws -> SavedItem? {
        var descriptor = FetchDescriptor<SavedItem>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    func item(dedupeKey: String) throws -> SavedItem? {
        var descriptor = FetchDescriptor<SavedItem>(predicate: #Predicate { $0.dedupeKey == dedupeKey })
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    func allItems() throws -> [SavedItem] {
        try context.fetch(FetchDescriptor<SavedItem>(sortBy: [SortDescriptor(\.lastSavedAt, order: .reverse)]))
    }

    private func commit() throws {
        do { try context.save() } catch {
            context.rollback()
            throw error
        }
    }
}
