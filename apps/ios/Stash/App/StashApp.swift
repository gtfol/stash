import SwiftData
import SwiftUI

@main struct StashApp: App {
    @State private var library: Library?
    @State private var failed = false

    private struct Library {
        let container: ModelContainer
        let model: LibraryModel
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if let library {
                    LibraryView(model: library.model).modelContainer(library.container)
                } else {
                    StartupView(failed: failed, retry: open)
                }
            }
            .preferredColorScheme(.dark)
            .task { if library == nil { open() } }
        }
    }

    private func open() {
        #if DEBUG
        UITestSupport.resetIfRequested()
        #endif
        do {
            let container = try SavedItemStore.makeContainer(in: .applicationSupportDirectory)
            let model = LibraryModel(store: SavedItemStore(context: container.mainContext), inbox: AppConfiguration.sharedInbox,
                                     extractor: SystemMetadataExtractor())
            library = Library(container: container, model: model)
            failed = false
            model.start()
        } catch {
            failed = true
        }
    }
}

struct StartupView: View {
    let failed: Bool
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("stash").font(StashStyle.heading)
            if failed {
                Text("your library couldn’t be opened.")
                    .font(StashStyle.caption)
                    .foregroundStyle(StashStyle.secondary)
                Button("try again", action: retry).frame(minHeight: StashStyle.touchTarget)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .stashScreen()
    }
}

#if DEBUG
/// UI tests launch with `-StashUITestReset` to start as a fresh install: no library, no
/// first-launch marker, and no pending shares. Debug builds only.
enum UITestSupport {
    static func resetIfRequested() {
        guard ProcessInfo.processInfo.arguments.contains("-StashUITestReset") else { return }
        for name in ["stash.store", "stash.store-shm", "stash.store-wal"] {
            try? FileManager.default.removeItem(at: URL.applicationSupportDirectory.appendingPathComponent(name))
        }
        UserDefaults.standard.removeObject(forKey: Seed.defaultsKey)
        if let inbox = AppConfiguration.sharedInbox { try? FileManager.default.removeItem(at: inbox.directory) }
    }
}
#endif
