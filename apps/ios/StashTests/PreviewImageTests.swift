import XCTest
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
@testable import Stash

final class PreviewImageTests: XCTestCase {
    private func png(width: Int, height: Int) throws -> Data {
        let context = try XCTUnwrap(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        context.setFillColor(CGColor(red: 0.2, green: 0.4, blue: 0.6, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let image = try XCTUnwrap(context.makeImage())
        let data = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data as CFMutableData, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, nil)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return data as Data
    }

    func testOnlyRealPreviewsAreShown() throws {
        let photo = try XCTUnwrap(ThumbnailLoader.previewImage(from: png(width: 1_200, height: 630), maxPixelSize: 168))
        XCTAssertEqual(max(photo.width, photo.height), 168, "decoded at the size shown, not full size")
        XCTAssertNotNil(ThumbnailLoader.previewImage(from: try png(width: 64, height: 64), maxPixelSize: 168))
        XCTAssertNil(ThumbnailLoader.previewImage(from: try png(width: 1, height: 1), maxPixelSize: 168), "tracking pixel")
        XCTAssertNil(ThumbnailLoader.previewImage(from: try png(width: 1_000, height: 100), maxPixelSize: 168), "thin banner")
        XCTAssertNil(ThumbnailLoader.previewImage(from: Data("<html>not an image</html>".utf8), maxPixelSize: 168))
    }
}
