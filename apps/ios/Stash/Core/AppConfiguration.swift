import Foundation

/// Identifiers that change when the app is renamed or moved to another team. They come from
/// build settings in `scripts/generate-project.py`, through each target's Info.plist.
enum AppConfiguration {
    static let appGroupKey = "StashAppGroupIdentifier"

    /// The App Group shared by the app and its share extension, e.g. `group.dev.gtfol.stash`.
    static var appGroupIdentifier: String? {
        (Bundle.main.object(forInfoDictionaryKey: appGroupKey) as? String).flatMap { $0.isEmpty ? nil : $0 }
    }

    static var sharedInbox: ShareInbox? { appGroupIdentifier.flatMap(ShareInbox.appGroup) }
}
