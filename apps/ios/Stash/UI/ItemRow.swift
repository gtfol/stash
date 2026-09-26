import SwiftUI

/// One saved link: preview tile, title, and a caption with the source, site, and save date, or
/// the details state while the title is still just the link.
struct ItemRow: View {
    let record: SavedItemRecord
    let fetching: Bool
    let open: () -> Void
    let details: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 4) {
            Button(action: open) {
                HStack(alignment: .top, spacing: 12) {
                    LinkThumbnail(imageURL: record.page.imageURL, host: record.host)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(record.title)
                            .font(StashStyle.itemTitle)
                            .foregroundStyle(StashStyle.text)
                            .lineLimit(3)
                            .multilineTextAlignment(.leading)
                        Text(caption)
                            .font(StashStyle.caption)
                            .foregroundStyle(StashStyle.secondary)
                            .lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(record.title)
            .accessibilityValue(caption)
            .accessibilityHint("opens \(record.host) in your browser")
            .accessibilityAddTraits(.isLink)
            .accessibilityAction(named: "details", details)
            .accessibilityIdentifier("item")

            Button(action: details) {
                Image(systemName: "info.circle")
                    .font(.system(size: 17, weight: .regular))
                    .foregroundStyle(StashStyle.secondary)
                    .frame(width: StashStyle.touchTarget, height: StashStyle.touchTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("details for \(record.title)")
            .accessibilityIdentifier("details")
        }
    }

    private var caption: String {
        var parts: [String] = []
        if let source = record.source, source.lowercased() != record.host { parts.append(source) }
        parts.append(record.host)
        if fetching && !record.hasTitle {
            parts.append("fetching details…")
        } else if let failure = record.metadataFailure, !record.hasTitle {
            parts.append(failure.shortMessage)
        } else {
            parts.append(Self.savedDate(record.lastSavedAt))
        }
        return parts.joined(separator: " · ")
    }

    static func savedDate(_ date: Date) -> String {
        let sameYear = Calendar.current.isDate(date, equalTo: .now, toGranularity: .year)
        let style: Date.FormatStyle = sameYear ? .dateTime.month(.abbreviated).day() : .dateTime.month(.abbreviated).day().year()
        return date.formatted(style)
    }
}
