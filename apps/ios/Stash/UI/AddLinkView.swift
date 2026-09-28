import SwiftUI

/// Typing or pasting a link by hand. Shows exactly what will be saved when that differs from what
/// was typed (a bare domain gains https://), and explains any rejection in place.
struct AddLinkView: View {
    let model: LibraryModel
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var error: String?
    @FocusState private var focused: Bool

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var resolved: String? {
        guard let link = try? WebLink.typed(text), link.string != WebLink.unwrapped(text) else { return nil }
        return link.string
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("add a link").font(StashStyle.heading)
                Spacer()
                Button("cancel") { dismiss() }
                    .frame(minWidth: StashStyle.touchTarget, minHeight: StashStyle.touchTarget)
            }
            VStack(alignment: .leading, spacing: 8) {
                TextField("link", text: $text, prompt: Text("https://").foregroundStyle(StashStyle.secondary))
                    .font(StashStyle.body)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .focused($focused)
                    .onSubmit(save)
                    .padding(.vertical, 12)
                    .overlay(alignment: .bottom) { Hairline() }
                    .accessibilityLabel("link")
                    .accessibilityIdentifier("link field")
                if let error {
                    Text(error)
                        .foregroundStyle(StashStyle.error)
                        .accessibilityIdentifier("add error")
                } else if let resolved {
                    Text("saves as \(resolved)").foregroundStyle(StashStyle.secondary)
                }
            }
            .font(StashStyle.caption)
            Button(action: save) { Text("save").frame(maxWidth: .infinity) }
                .stashPrimaryAction()
                .disabled(trimmed.isEmpty)
                .accessibilityIdentifier("save link")
            Spacer(minLength: 0)
        }
        .padding(StashStyle.gutter)
        .stashScreen()
        .presentationDetents([.medium, .large])
        .presentationBackground(StashStyle.canvas)
        .onAppear { focused = true }
        .onChange(of: text) { error = nil }
    }

    private func save() {
        guard !trimmed.isEmpty else { return }
        do {
            try model.save(typed: text)
            dismiss()
        } catch {
            self.error = error.localizedDescription
            AccessibilityNotification.Announcement(error.localizedDescription).post()
        }
    }
}
