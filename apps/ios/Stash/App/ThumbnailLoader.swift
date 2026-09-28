import Foundation
import ImageIO

/// Loads preview images for saved links. An image is shown only if it downloads within the size
/// limit, decodes, and looks like a real preview (not a tracking pixel or a thin banner);
/// otherwise the view keeps its text tile. Decoded images stay in memory; downloads use a disk
/// URLCache, so previews already seen still show offline.
actor ThumbnailLoader {
    static let shared = ThumbnailLoader()

    private let session: URLSession
    private let byteLimit = 5_000_000
    private var images: [String: CGImage] = [:]
    private var order: [String] = []
    private var failures: [String: Date] = [:]

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        configuration.urlCache = URLCache(memoryCapacity: 8_000_000, diskCapacity: 64_000_000,
                                          directory: URL.cachesDirectory.appendingPathComponent("previews", isDirectory: true))
        session = URLSession(configuration: configuration)
    }

    func image(for link: String, maxPixelSize: Int) async -> CGImage? {
        let key = "\(maxPixelSize)|\(link)"
        if let image = images[key] {
            order.removeAll { $0 == key }
            order.append(key)
            return image
        }
        // A failed preview isn't retried while scrolling; it gets another chance after a while.
        if let failed = failures[link], Date().timeIntervalSince(failed) < 600 { return nil }
        guard let data = await download(link) else {
            if !Task.isCancelled { failures[link] = Date() }
            return nil
        }
        guard let image = Self.previewImage(from: data, maxPixelSize: maxPixelSize) else {
            failures[link] = Date()
            return nil
        }
        images[key] = image
        order.append(key)
        while order.count > 150 { images[order.removeFirst()] = nil }
        return image
    }

    private func download(_ link: String) async -> Data? {
        guard let url = URL(string: link).map(HTMLMetadataExtractor.secureURL),
              let download = try? await session.bytes(from: url) else { return nil }
        let (bytes, response) = download
        defer { bytes.task.cancel() }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              http.mimeType.map({ $0.hasPrefix("image/") }) ?? true,
              http.expectedContentLength <= Int64(byteLimit) else { return nil }
        var data = Data()
        do {
            for try await byte in bytes {
                data.append(byte)
                if data.count > byteLimit { return nil }
            }
        } catch {
            return nil
        }
        return data
    }

    static func previewImage(from data: Data, maxPixelSize: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              min(width, height) >= 64, max(width, height) <= 4 * min(width, height) else { return nil }
        return CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
            kCGImageSourceShouldCacheImmediately: true
        ] as CFDictionary)
    }
}
