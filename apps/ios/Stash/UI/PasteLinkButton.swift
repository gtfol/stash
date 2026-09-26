import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The system paste control. It reads the clipboard only when tapped and shows no permission
/// prompt. iOS draws its label ("Paste"), so it is the one piece of copy stash can't lowercase.
struct PasteLinkButton: UIViewRepresentable {
    let onPaste: @MainActor ([NSItemProvider]) -> Void

    func makeUIView(context: Context) -> PasteTarget {
        let target = PasteTarget()
        target.onPaste = onPaste
        return target
    }

    func updateUIView(_ target: PasteTarget, context: Context) {
        target.onPaste = onPaste
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView target: PasteTarget, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 160, height: max(50, target.fittingHeight))
    }

    /// Receives the paste. Accepting URLs and plain text also enables the control only when the
    /// clipboard holds one of them.
    final class PasteTarget: UIView {
        var onPaste: (@MainActor ([NSItemProvider]) -> Void)?
        private let control: UIPasteControl

        override init(frame: CGRect) {
            let configuration = UIPasteControl.Configuration()
            configuration.displayMode = .iconAndLabel
            configuration.cornerStyle = .fixed
            configuration.cornerRadius = 2
            // Explicit colors: the system ignores taps on paste controls it can't read clearly.
            configuration.baseBackgroundColor = UIColor(white: 238 / 255, alpha: 1)
            configuration.baseForegroundColor = .black
            control = UIPasteControl(configuration: configuration)
            super.init(frame: frame)
            pasteConfiguration = UIPasteConfiguration(acceptableTypeIdentifiers: [UTType.url.identifier, UTType.plainText.identifier])
            control.target = self
            control.translatesAutoresizingMaskIntoConstraints = false
            addSubview(control)
            NSLayoutConstraint.activate([
                control.leadingAnchor.constraint(equalTo: leadingAnchor),
                control.trailingAnchor.constraint(equalTo: trailingAnchor),
                control.topAnchor.constraint(equalTo: topAnchor),
                control.bottomAnchor.constraint(equalTo: bottomAnchor)
            ])
        }

        required init?(coder: NSCoder) { nil }

        var fittingHeight: CGFloat { control.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize).height }

        override func paste(itemProviders: [NSItemProvider]) {
            onPaste?(itemProviders)
        }
    }
}
