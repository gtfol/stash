import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

// stash's mark: a lowercase "s" in Lato Regular, the app's bundled typeface, in #eeeeee on an
// opaque black canvas like the library itself. Run from apps/ios: `swift scripts/make-icon.swift`.
let size = 1_024
let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(CGColor(gray: 0, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: size, height: size))

let fontURL = URL(fileURLWithPath: "Stash/Resources/Lato-Regular.ttf")
guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(fontURL as CFURL) as? [CTFontDescriptor],
      let descriptor = descriptors.first else { fatalError("Stash/Resources/Lato-Regular.ttf not found; run from apps/ios.") }
let font = CTFontCreateWithFontDescriptor(descriptor, 880, nil)
let mark = NSAttributedString(string: "s", attributes: [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 238 / 255, alpha: 1)
])
let line = CTLineCreateWithAttributedString(mark)
// Center the letter's ink rather than its advance box.
let ink = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
context.textPosition = CGPoint(x: (CGFloat(size) - ink.width) / 2 - ink.minX, y: (CGFloat(size) - ink.height) / 2 - ink.minY)
CTLineDraw(line, context)

let url = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "Stash/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
let output = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(output, context.makeImage()!, nil)
precondition(CGImageDestinationFinalize(output))
