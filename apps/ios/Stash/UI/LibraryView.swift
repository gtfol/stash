import SwiftData
import SwiftUI

/// The one screen: saved links, newest save first. Tapping a row opens its saved link in the
/// browser; the info button opens its details.
struct LibraryView: View {
    let model: LibraryModel
    @Query(sort: \SavedItem.lastSavedAt, order: .reverse) private var items: [SavedItem]
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @State private var query = ""
    @State private var detail: DetailSelection?
    @State private var adding = false
    @State private var confirmingDelete: SavedItemRecord?
    @State private var pendingDelete: UUID?

    private struct DetailSelection: Identifiable {
        let id: UUID
    }

    var body: some View {
        NavigationStack {
            library
                .navigationTitle("stash")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) { Text("stash").font(StashStyle.heading) }
                }
                .toolbarBackground(StashStyle.canvas, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
                .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: Text("search"))
                .safeAreaInset(edge: .bottom, spacing: 0) { AddBar(model: model) { adding = true } }
                .stashScreen()
        }
        .sheet(item: $detail, onDismiss: deletePending) { selection in
            ItemDetailView(id: selection.id, model: model) {
                pendingDelete = selection.id
                detail = nil
            }
        }
        .sheet(isPresented: $adding) { AddLinkView(model: model) }
        .alert("delete this link?", isPresented: isConfirmingDelete, presenting: confirmingDelete) { record in
            Button("delete", role: .destructive) { model.delete(record.id) }
            Button("cancel", role: .cancel) {}
        } message: { record in
            Text(record.title)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.becameActive() }
            if phase == .background { model.enteredBackground() }
        }
        .onChange(of: model.focusRequest) { _, request in
            // A new save should be visible even if a search was hiding it.
            if request != nil { query = "" }
        }
    }

    @ViewBuilder private var library: some View {
        let records = items.map(\.record)
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let visible = trimmed.isEmpty ? records : records.filter { $0.matches(trimmed) }
        if records.isEmpty {
            EmptyState(title: "nothing saved yet", message: "paste a link below, or share one to stash from safari or any app.")
        } else if visible.isEmpty {
            EmptyState(title: "no matches", message: "search looks at titles, sites, and links.")
        } else {
            ScrollViewReader { proxy in
                List {
                    ForEach(visible) { record in
                        row(record, first: record.id == visible.first?.id)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .scrollDismissesKeyboard(.immediately)
                .onChange(of: model.focusRequest) { _, request in
                    guard let request else { return }
                    withAnimation { proxy.scrollTo(request.itemID, anchor: .top) }
                }
            }
        }
    }

    private func row(_ record: SavedItemRecord, first: Bool) -> some View {
        ItemRow(record: record, fetching: model.refresher.fetching.contains(record.id),
                open: { open(record) }, details: { detail = DetailSelection(id: record.id) })
            .listRowInsets(EdgeInsets(top: 0, leading: StashStyle.gutter, bottom: 0, trailing: 4))
            .listRowBackground(StashStyle.canvas)
            .listRowSeparatorTint(StashStyle.divider)
            // Hairlines run from the gutter, not from the tile's letter, and only between items.
            .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
            .listRowSeparator(first ? .hidden : .visible, edges: .top)
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button { confirmingDelete = record } label: { Label("delete", systemImage: "trash") }
                    .tint(.red)
            }
            .contextMenu {
                Button { open(record) } label: { Label("open link", systemImage: "safari") }
                Button { detail = DetailSelection(id: record.id) } label: { Label("details", systemImage: "info.circle") }
                Button { model.copyLink(record) } label: { Label("copy link", systemImage: "doc.on.doc") }
                Button(role: .destructive) { confirmingDelete = record } label: { Label("delete", systemImage: "trash") }
            }
            .id(record.id)
    }

    private var isConfirmingDelete: Binding<Bool> {
        Binding(get: { confirmingDelete != nil }, set: { if !$0 { confirmingDelete = nil } })
    }

    private func open(_ record: SavedItemRecord) {
        guard let url = URL(string: record.url) else { return model.show(.problem, "this link can’t be opened.") }
        openURL(url) { accepted in
            if !accepted { model.show(.problem, "no app could open this link.") }
        }
    }

    // Deleting after the details sheet has closed keeps it from showing a removed item.
    private func deletePending() {
        guard let id = pendingDelete else { return }
        pendingDelete = nil
        model.delete(id)
    }
}

struct EmptyState: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 8) {
            Text(title).font(StashStyle.heading)
            Text(message)
                .font(StashStyle.caption)
                .foregroundStyle(StashStyle.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(StashStyle.gutter)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
