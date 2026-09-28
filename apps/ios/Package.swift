// swift-tools-version: 6.0
import PackageDescription

// Runs the dependency-free core (links, share inbox, metadata parsing) on macOS with `swift test`.
// Tests of the app module (SwiftData store, library model, previews) run in the iPhone simulator
// through scripts/test-ios.sh.
let package = Package(
    name: "StashCore",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "StashCore", targets: ["StashCore"])],
    targets: [
        .target(name: "StashCore", path: "Stash/Core"),
        .testTarget(name: "StashCoreTests", dependencies: ["StashCore"], path: "StashTests", exclude: ["LibraryModelTests.swift", "PreviewImageTests.swift", "StoreTests.swift"])
    ]
)
