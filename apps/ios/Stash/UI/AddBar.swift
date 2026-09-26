import SwiftUI

/// The bottom bar: the prominent paste control, typing as the alternative, and a line for what
/// just happened (saved, already saved, or why nothing was saved).
struct AddBar: View {
    let model: LibraryModel
    let type: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let notice = model.notice {
                NoticeLine(notice: notice, dismiss: model.dismissNotice)
            } else if !model.isOnline {
                Text("you’re offline. links still save; details load later.")
                    .font(StashStyle.caption)
                    .foregroundStyle(StashStyle.secondary)
                    .padding(.horizontal, StashStyle.gutter)
                    .padding(.vertical, 12)
            }
            Hairline()
            let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 16))
            layout {
                PasteLinkButton { providers in
                    Task { await model.paste(providers) }
                }
                .frame(maxWidth: .infinity)
                .accessibilityHint("saves the link on your clipboard")
                Button("type a link", action: type)
                    .font(StashStyle.body)
                    .frame(minHeight: StashStyle.touchTarget)
            }
            .padding(.horizontal, StashStyle.gutter)
            .padding(.vertical, 12)
        }
        .background(StashStyle.canvas)
    }
}

struct NoticeLine: View {
    let notice: LibraryModel.Notice
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Text(notice.text)
                .font(StashStyle.caption)
                .foregroundStyle(notice.kind == .problem ? StashStyle.error : StashStyle.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("notice")
            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 12))
                    .frame(width: StashStyle.touchTarget, height: StashStyle.touchTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(StashStyle.secondary)
            .accessibilityLabel("dismiss message")
        }
        .padding(.leading, StashStyle.gutter)
        .padding(.trailing, 4)
    }
}
