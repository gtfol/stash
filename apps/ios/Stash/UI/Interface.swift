import SwiftUI

/// stash's type, spacing, and palette: gtfol's shared dark tokens (DESIGN.md in gtfol/ai), which
/// capsule's iPhone app also uses, with bundled Lato Regular scaled by Dynamic Type.
enum StashStyle {
    static let canvas = Color.black
    static let text = Color(white: 238 / 255)
    static let secondary = Color(white: 170 / 255)
    static let divider = Color(white: 44 / 255)
    /// Quiet fill for placeholders, from the design standard's hover surface.
    static let surface = Color(white: 17 / 255)
    static let error = Color(red: 239 / 255, green: 150 / 255, blue: 150 / 255)

    static let body = Font.custom("Lato-Regular", size: 15, relativeTo: .subheadline)
    static let caption = Font.custom("Lato-Regular", size: 13, relativeTo: .footnote)
    static let heading = Font.custom("Lato-Regular", size: 17, relativeTo: .headline)
    /// Saved titles are reading content, a step above interface text.
    static let itemTitle = Font.custom("Lato-Regular", size: 17, relativeTo: .body)
    static let detailTitle = Font.custom("Lato-Regular", size: 22, relativeTo: .title3)

    static let gutter: CGFloat = 20
    static let touchTarget: CGFloat = 44
}

extension View {
    func stashScreen() -> some View {
        font(StashStyle.body)
            .foregroundStyle(StashStyle.text)
            .tint(StashStyle.text)
            .background(StashStyle.canvas)
    }

    /// The one filled button on a screen, as in capsule: light on black, nearly square corners.
    func stashPrimaryAction() -> some View {
        buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 2))
            .controlSize(.large)
            .tint(StashStyle.text)
            .foregroundStyle(StashStyle.canvas)
    }
}

/// A full-width hairline, the only separator stash uses.
struct Hairline: View {
    var body: some View {
        Rectangle().fill(StashStyle.divider).frame(height: 0.5).accessibilityHidden(true)
    }
}
