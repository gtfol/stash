import SwiftData
import SwiftUI

/// Everything known about one saved link. "open link" always opens the saved link itself; an
/// original publisher link, when known, is shown for reference only.
struct ItemDetailView: View {
    let model: LibraryModel
    let delete: () -> Void
    @Query private var items: [SavedItem]
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var editing = false
    @State private var draft = ""
    @State private var copied = false
    @State private var confirmingDelete = false
    @FocusState private var titleFocused: Bool

    init(id: UUID, model: LibraryModel, delete: @escaping () -> Void) {
        self.model = model
        self.delete = delete
        _items = Query(filter: #Predicate<SavedItem> { $0.id == id })
    }

    var body: some View {
        NavigationStack {
            Group {
                if let record = items.first?.record {
                    content(record)
                } else {
                    Color.clear
                }
            }
            .navigationTitle("details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) { Text("details").font(StashStyle.heading) }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("done") { dismiss() }.font(StashStyle.body)
                }
            }
            .toolbarBackground(StashStyle.canvas, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .stashScreen()
        }
        .presentationBackground(StashStyle.canvas)
    }

    private func content(_ record: SavedItemRecord) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PreviewImage(imageURL: record.page.imageURL)
                header(record)
                if let summary = record.page.summary {
                    Text(summary).foregroundStyle(StashStyle.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Button { open(record) } label: { Text("open link").frame(maxWidth: .infinity) }
                    .stashPrimaryAction()
                    .accessibilityHint("opens \(record.host) in your browser")
                    .accessibilityIdentifier("open link")
                facts(record)
                status(record)
                Button("delete link", role: .destructive) { confirmingDelete = true }
                    .foregroundStyle(StashStyle.error)
                    .frame(minHeight: StashStyle.touchTarget)
            }
            .padding(StashStyle.gutter)
        }
        .scrollDismissesKeyboard(.interactively)
        .confirmationDialog("delete this link?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("delete", role: .destructive, action: delete)
            Button("cancel", role: .cancel) {}
        } message: {
            Text(record.title)
        }
    }

    // MARK: Sections

    private func header(_ record: SavedItemRecord) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(record.source ?? record.host)
                .font(StashStyle.caption)
                .foregroundStyle(StashStyle.secondary)
            if editing {
                TextField("title", text: $draft, prompt: Text(record.automaticTitle).foregroundStyle(StashStyle.secondary), axis: .vertical)
                    .font(StashStyle.detailTitle)
                    .focused($titleFocused)
                    .submitLabel(.done)
                    .padding(.vertical, 4)
                    .overlay(alignment: .bottom) { Hairline() }
                    .accessibilityIdentifier("title field")
                    .onChange(of: draft) { _, value in
                        // Return ends editing; titles are one line.
                        if value.contains("\n") { saveTitle(record, value.replacingOccurrences(of: "\n", with: " ")) }
                    }
                Text("leave it empty to use the page’s own title.")
                    .font(StashStyle.caption)
                    .foregroundStyle(StashStyle.secondary)
                HStack(spacing: 24) {
                    Button("save title") { saveTitle(record, draft) }
                        .frame(minHeight: StashStyle.touchTarget)
                    Button("cancel") { editing = false }
                        .foregroundStyle(StashStyle.secondary)
                        .frame(minHeight: StashStyle.touchTarget)
                }
            } else {
                Text(record.title)
                    .font(StashStyle.detailTitle)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Button("edit title") {
                    draft = record.customTitle ?? record.title
                    editing = true
                    titleFocused = true
                }
                .font(StashStyle.caption)
                .foregroundStyle(StashStyle.secondary)
                .frame(minHeight: StashStyle.touchTarget)
            }
            if let byline = byline(record) {
                Text(byline).font(StashStyle.caption).foregroundStyle(StashStyle.secondary)
            }
        }
    }

    private func facts(_ record: SavedItemRecord) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                label("link")
                Text(record.url).textSelection(.enabled).accessibilityIdentifier("saved link")
                Button(copied ? "copied" : "copy link") {
                    UIPasteboard.general.string = record.url
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(2))
                        copied = false
                    }
                }
                .font(StashStyle.caption)
                .foregroundStyle(StashStyle.secondary)
                .frame(minHeight: StashStyle.touchTarget)
            }
            if let original = record.originalURL {
                VStack(alignment: .leading, spacing: 4) {
                    label("original")
                    Text(original).foregroundStyle(StashStyle.secondary).textSelection(.enabled)
                    Text("for reference. open link uses the saved link above.")
                        .font(StashStyle.caption)
                        .foregroundStyle(StashStyle.secondary)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                label("saved")
                Text(record.createdAt.formatted(date: .abbreviated, time: .shortened))
                if record.lastSavedAt.timeIntervalSince(record.createdAt) > 60 {
                    Text("saved again \(record.lastSavedAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(StashStyle.caption)
                        .foregroundStyle(StashStyle.secondary)
                }
            }
        }
    }

    private func status(_ record: SavedItemRecord) -> some View {
        let fetching = model.refresher.fetching.contains(record.id)
        return VStack(alignment: .leading, spacing: 4) {
            label("details")
            if fetching {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("fetching details…")
                }
            } else if let failure = record.metadataFailure {
                Text(failure.message)
            } else if record.metadataStatus == .fetched {
                Text(record.page.isEmpty ? "the page didn’t describe itself." : "read from the page.")
            } else {
                Text("not fetched yet.")
            }
            if record.known != nil {
                Text("the title, source, author, and date came with this link. refreshing doesn’t change them.")
                    .font(StashStyle.caption)
                    .foregroundStyle(StashStyle.secondary)
            }
            if !fetching {
                Button(record.metadataStatus == .failed ? "try again" : "refresh details") { model.refreshDetails(record) }
                    .font(StashStyle.caption)
                    .foregroundStyle(StashStyle.secondary)
                    .frame(minHeight: StashStyle.touchTarget)
            }
        }
    }

    // MARK: Helpers

    private func label(_ text: String) -> some View {
        Text(text).font(StashStyle.caption).foregroundStyle(StashStyle.secondary)
    }

    private func byline(_ record: SavedItemRecord) -> String? {
        let parts = [record.author, record.publishedDate.flatMap { PublicationDate.display($0) }].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func saveTitle(_ record: SavedItemRecord, _ title: String) {
        model.rename(record.id, to: title)
        editing = false
        titleFocused = false
    }

    private func open(_ record: SavedItemRecord) {
        guard let url = URL(string: record.url) else { return }
        openURL(url)
    }
}
