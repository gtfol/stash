import Foundation
import UniformTypeIdentifiers

/// Finds the one web link in what another app shared or what was pasted. URL items win over text;
/// text must hold exactly one explicit http(s) link. Nothing is fetched or guessed here.
enum SharedPayload {
    /// Shared items reduced to strings, so choosing a link is a pure, testable step.
    struct Contents: Equatable, Sendable {
        var urls: [String] = []
        var texts: [String] = []
    }

    static func link(in contents: Contents) throws -> WebLink {
        var links: [WebLink] = []
        var otherSchemes: [String] = []
        for text in contents.urls {
            do {
                let link = try WebLink(text)
                if !links.contains(where: { $0.dedupeKey == link.dedupeKey }) { links.append(link) }
            } catch LinkError.unsupportedScheme(let scheme) {
                otherSchemes.append(scheme)
            } catch {}
        }
        if links.count == 1 { return links[0] }
        if links.count > 1 { throw LinkError.multipleLinks }

        for text in contents.texts {
            let scan = WebLink.scan(text)
            for link in scan.links where !links.contains(where: { $0.dedupeKey == link.dedupeKey }) { links.append(link) }
            otherSchemes += scan.otherSchemes
        }
        if links.count == 1 { return links[0] }
        if links.count > 1 { throw LinkError.multipleLinks }
        if let scheme = otherSchemes.first { throw LinkError.unsupportedScheme(scheme) }
        throw LinkError.noLink
    }

    /// Reads URL and plain-text items. `extraText` is text the host app attached outside its
    /// items (a share's `attributedContentText`).
    @MainActor static func contents(of providers: [NSItemProvider], extraText: [String] = []) async -> Contents {
        var contents = Contents()
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                var text = await loadObject(provider, as: NSURL.self)
                if text == nil { text = await loadItem(provider, type: UTType.url.identifier) }
                if let text { contents.urls.append(text) }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                var text = await loadObject(provider, as: NSString.self)
                if text == nil { text = await loadItem(provider, type: UTType.plainText.identifier) }
                if let text { contents.texts.append(text) }
            }
        }
        contents.texts += extraText.filter { !$0.isEmpty }
        return contents
    }

    // Completions run on arbitrary queues: they are explicitly @Sendable (never main-actor
    // isolated) and only hand back a String.
    @MainActor private static func loadObject(_ provider: NSItemProvider, as type: any NSItemProviderReading.Type) async -> String? {
        guard provider.canLoadObject(ofClass: type) else { return nil }
        return await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: type) { @Sendable object, _ in
                continuation.resume(returning: string(from: object))
            }
        }
    }

    @MainActor private static func loadItem(_ provider: NSItemProvider, type: String) async -> String? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: type, options: nil) { @Sendable item, _ in
                continuation.resume(returning: string(from: item))
            }
        }
    }

    static func string(from item: Any?) -> String? {
        switch item {
        case let url as URL:
            return url.absoluteString
        case let text as String:
            return text
        case let text as NSAttributedString:
            return text.string
        case let data as Data:
            // Some apps hand over a URL's property-list representation rather than its text.
            if data.starts(with: Array("bplist".utf8)),
               let list = try? PropertyListSerialization.propertyList(from: data, format: nil) {
                return ((list as? [Any])?.first as? String) ?? (list as? String)
            }
            return String(data: data, encoding: .utf8)
        default:
            return nil
        }
    }
}
