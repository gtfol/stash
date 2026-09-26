import SwiftUI
import UIKit

/// The share sheet entry. It finds the one web link in what was shared and queues it in the App
/// Group inbox, confirming only after that write is flushed. It never fetches the page or opens
/// the library; stash imports the record the next time it opens.
final class ShareViewController: UIViewController {
    private let state = ShareState()
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = .dark
        view.backgroundColor = .clear
        let card = UIHostingController(rootView: ShareCard(state: state) { [weak self] in self?.finish() })
        card.view.backgroundColor = .clear
        card.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(card)
        view.addSubview(card.view)
        NSLayoutConstraint.activate([
            card.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            card.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            card.view.topAnchor.constraint(equalTo: view.topAnchor),
            card.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        card.didMove(toParent: self)
        Task { await save() }
    }

    private func save() async {
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        let text = items.compactMap { $0.attributedContentText?.string }
        // A host app that never delivers its items shouldn't leave the sheet spinning.
        let watchdog = Task { [state] in
            try await Task.sleep(for: .seconds(10))
            if state.phase == .saving { state.phase = .failed("couldn’t read what was shared. nothing was saved.") }
        }
        defer { watchdog.cancel() }
        let contents = await SharedPayload.contents(of: providers, extraText: text)
        do {
            let link = try SharedPayload.link(in: contents)
            guard let inbox = AppConfiguration.sharedInbox else {
                state.phase = .failed("stash can’t receive shares until its app group is set up. nothing was saved.")
                return
            }
            try inbox.enqueue(link)
            state.phase = .saved(WebLink.displayHost(ofLink: link.string) ?? link.string)
            try? await Task.sleep(for: .milliseconds(900))
            finish()
        } catch let error as LinkError {
            state.phase = .failed(error.localizedDescription)
        } catch {
            state.phase = .failed("couldn’t save the link. nothing was saved. try again.")
        }
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        extensionContext?.completeRequest(returningItems: nil)
    }
}

@MainActor @Observable final class ShareState {
    enum Phase: Equatable {
        case saving
        case saved(String)
        case failed(String)
    }

    var phase = Phase.saving
}

/// A small card over the host app: saving, saved (then it closes itself), or why nothing was saved.
struct ShareCard: View {
    let state: ShareState
    let close: () -> Void

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture { if state.phase != .saving { close() } }
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 16) {
                switch state.phase {
                case .saving:
                    HStack(spacing: 12) {
                        ProgressView()
                        Text("saving to stash…")
                    }
                case .saved(let host):
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Image(systemName: "checkmark").accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("saved to stash")
                            Text(host).font(StashStyle.caption).foregroundStyle(StashStyle.secondary)
                        }
                    }
                case .failed(let message):
                    Text(message)
                        .foregroundStyle(StashStyle.error)
                        .fixedSize(horizontal: false, vertical: true)
                    Button(action: close) { Text("close").frame(maxWidth: .infinity) }
                        .stashPrimaryAction()
                }
            }
            .padding(StashStyle.gutter)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(StashStyle.canvas, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(StashStyle.divider, lineWidth: 0.5))
            .padding(16)
            .accessibilityElement(children: .contain)
        }
        .font(StashStyle.body)
        .foregroundStyle(StashStyle.text)
        .tint(StashStyle.text)
        .animation(.easeOut(duration: 0.2), value: state.phase)
    }
}
