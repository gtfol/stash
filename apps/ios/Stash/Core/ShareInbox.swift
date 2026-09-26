import Foundation

/// One shared link waiting for the app. The share extension writes it once; the app imports and
/// then removes it. Fields are additive-only so a newer extension never strands an older app.
struct InboxRecord: Codable, Equatable, Sendable {
    static let currentVersion = 1
    var version = InboxRecord.currentVersion
    var id: UUID
    var url: String
    var sharedAt: Date
}

/// A folder of JSON records in the App Group container. The extension publishes each record as a
/// complete file (write, flush, rename) and never touches it again; the app reads complete files
/// and deletes them only after its database save. Neither side sees a partial file, so the two
/// processes need no locks, and only the app ever opens the SwiftData store.
struct ShareInbox: Sendable {
    let directory: URL

    /// Nil when the App Group entitlement is missing or doesn't match the configured identifier.
    static func appGroup(_ identifier: String) -> ShareInbox? {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier) else { return nil }
        return ShareInbox(directory: container.appendingPathComponent("Inbox", isDirectory: true))
    }

    /// Durably queues a link. Returns only after the record is flushed and published under its
    /// final name, so the extension can confirm the save.
    @discardableResult
    func enqueue(_ link: WebLink, sharedAt: Date = Date(), id: UUID = UUID()) throws -> InboxRecord {
        let milliseconds = (sharedAt.timeIntervalSince1970 * 1_000).rounded()
        let record = InboxRecord(id: id, url: link.string, sharedAt: Date(timeIntervalSince1970: milliseconds / 1_000))
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let name = Self.fileName(for: record)
        let partial = directory.appendingPathComponent(".\(name).partial")
        let final = directory.appendingPathComponent(name)
        try Self.writeDurably(Self.encoder.encode(record), to: partial, publishingAs: final, in: directory)
        return record
    }

    struct Entry: Sendable, Equatable {
        let file: URL
        let record: InboxRecord
    }

    struct Contents: Sendable {
        var entries: [Entry] = []
        /// Files that can't be decoded; set aside so one bad file never blocks the rest.
        var unreadable: [URL] = []
    }

    /// Complete records, oldest share first. Records from a newer app version are left in place.
    func contents() throws -> Contents {
        guard FileManager.default.fileExists(atPath: directory.path) else { return Contents() }
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
        var contents = Contents()
        for file in files where file.pathExtension == "json" {
            guard let data = try? Data(contentsOf: file), let record = try? Self.decoder.decode(InboxRecord.self, from: data) else {
                contents.unreadable.append(file); continue
            }
            if record.version > InboxRecord.currentVersion { continue }
            contents.entries.append(Entry(file: file, record: record))
        }
        contents.entries.sort { ($0.record.sharedAt, $0.record.id.uuidString) < ($1.record.sharedAt, $1.record.id.uuidString) }
        return contents
    }

    func remove(_ entry: Entry) throws {
        do { try FileManager.default.removeItem(at: entry.file) }
        catch CocoaError.fileNoSuchFile { }
    }

    /// Renames an undecodable or invalid record so it stops being retried but can still be inspected.
    func setAside(_ file: URL) {
        try? FileManager.default.moveItem(at: file, to: file.appendingPathExtension("unreadable"))
    }

    /// Removes half-written files left by an extension that was stopped mid-write.
    func removeAbandonedPartials(olderThan age: TimeInterval = 600, now: Date = Date()) {
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        for file in files where file.lastPathComponent.hasPrefix(".") && file.pathExtension == "partial" {
            let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            if now.timeIntervalSince(modified) > age { try? FileManager.default.removeItem(at: file) }
        }
    }

    // Sortable and unique: milliseconds since 1970, then the record's UUID.
    static func fileName(for record: InboxRecord) -> String {
        let milliseconds = max(0, Int64((record.sharedAt.timeIntervalSince1970 * 1_000).rounded()))
        return String(format: "%015lld-", milliseconds) + record.id.uuidString.lowercased() + ".json"
    }

    private static func writeDurably(_ data: Data, to partial: URL, publishingAs final: URL, in directory: URL) throws {
        guard FileManager.default.createFile(atPath: partial.path, contents: nil) else { throw CocoaError(.fileWriteUnknown) }
        do {
            let handle = try FileHandle(forWritingTo: partial)
            defer { try? handle.close() }
            try handle.write(contentsOf: data)
            try handle.synchronize()
        } catch {
            try? FileManager.default.removeItem(at: partial)
            throw error
        }
        // rename(2) publishes the complete file atomically; readers only list final names.
        guard rename(partial.path, final.path) == 0 else {
            let code = POSIXErrorCode(rawValue: errno) ?? .EIO
            try? FileManager.default.removeItem(at: partial)
            throw POSIXError(code)
        }
        // Flush the directory entry too, so the new name survives a power loss.
        let descriptor = open(directory.path, O_RDONLY)
        if descriptor >= 0 { _ = fsync(descriptor); _ = close(descriptor) }
    }

    // Unix milliseconds, like freewrite's records: exact enough to compare repeated imports.
    private static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return decoder
    }
}
