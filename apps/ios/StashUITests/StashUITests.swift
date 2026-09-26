import UIKit
import XCTest

/// Drives the real app in the simulator. Launching with `-StashUITestReset` starts from a fresh
/// install. Page details may or may not load from the network, so no assertion depends on them.
final class StashUITests: XCTestCase {
    private let seedTitle = "How to make a brain: new experiments challenge existing picture"
    private let delete = XCUIKeyboardKey.delete.rawValue

    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor func testFirstLaunchSaveSearchRenameAndDelete() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-StashUITestReset"]
        app.launch()

        // The first-launch article appears once, and details show the exact archived link.
        XCTAssertTrue(row(app, seedTitle).waitForExistence(timeout: 15))
        XCTAssertEqual(items(app).count, 1)
        snapshot(app, "01 library, first launch")
        button(app, "details for \(seedTitle)").tap()
        XCTAssertTrue(text(app, "https://archive.ph/GDsbC").waitForExistence(timeout: 5))
        XCTAssertTrue(text(app, "https://www.nature.com/articles/d41586-026-02943-1").exists)
        XCTAssertTrue(text(app, "Lynne Peeples · Sep 18, 2026").exists)
        snapshot(app, "02 details")
        button(app, "done").tap()

        // Another scheme is refused with a reason, and nothing is saved.
        button(app, "type a link").tap()
        let field = app.textFields["link field"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("ftp://files.example.com/report.pdf")
        app.buttons["save link"].tap()
        XCTAssertTrue(text(app, "stash saves http and https links, not ftp links. nothing was saved.").waitForExistence(timeout: 5))
        snapshot(app, "03 unsupported scheme")

        // A typed domain shows what will be saved, then saves at once, before any details.
        field.typeText(String(repeating: delete, count: 40) + "example.com/stash-ui-test")
        XCTAssertTrue(text(app, "saves as https://example.com/stash-ui-test").waitForExistence(timeout: 5))
        app.buttons["save link"].tap()
        XCTAssertTrue(eventually { self.items(app).count == 2 })
        snapshot(app, "04 saved")

        // Saving the same page again keeps one item.
        button(app, "type a link").tap()
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("https://www.example.com/stash-ui-test/?utm_source=ui-test")
        app.buttons["save link"].tap()
        XCTAssertTrue(text(app, "already saved. moved to the top.").waitForExistence(timeout: 5))
        XCTAssertEqual(items(app).count, 2)

        // Search matches titles, sites, and links.
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("brain")
        XCTAssertTrue(eventually { self.items(app).count == 1 })
        search.typeText(" zzz")
        XCTAssertTrue(text(app, "no matches").waitForExistence(timeout: 5))
        snapshot(app, "05 no matches")
        search.typeText(String(repeating: delete, count: 20))
        XCTAssertTrue(eventually { self.items(app).count == 2 })

        // Rename the newest item; the new title shows in the list.
        app.buttons.matching(identifier: "details").element(boundBy: 0).tap()
        button(app, "edit title").tap()
        let title = app.descendants(matching: .any).matching(identifier: "title field").firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        title.typeText(String(repeating: delete, count: 80) + "my renamed link")
        button(app, "save title").tap()
        XCTAssertTrue(text(app, "my renamed link").waitForExistence(timeout: 5))
        button(app, "done").tap()
        XCTAssertTrue(row(app, "my renamed link").waitForExistence(timeout: 5))

        // Relaunch: saved links remain and the first-launch article isn't added again.
        app.terminate()
        app.launchArguments = []
        app.launch()
        XCTAssertTrue(row(app, seedTitle).waitForExistence(timeout: 15))
        XCTAssertTrue(eventually { self.items(app).count == 2 })

        // Delete the article after confirming; it stays deleted after another relaunch.
        button(app, "details for \(seedTitle)").tap()
        button(app, "delete link").tap()
        XCTAssertTrue(text(app, "delete this link?").waitForExistence(timeout: 5))
        snapshot(app, "06 confirm delete")
        confirmButton(app, "delete").tap()
        XCTAssertTrue(eventually { !self.row(app, self.seedTitle).exists })
        app.terminate()
        app.launch()
        XCTAssertTrue(row(app, "my renamed link").waitForExistence(timeout: 15))
        XCTAssertFalse(row(app, seedTitle).exists)
        XCTAssertEqual(items(app).count, 1)
        snapshot(app, "07 after delete and relaunch")
    }

    @MainActor func testPasteSavesTheLinkOnTheClipboard() throws {
        UIPasteboard.general.string = "read later: https://example.org/pasted-in-a-ui-test"
        let app = XCUIApplication()
        app.launchArguments = ["-StashUITestReset"]
        app.launch()
        XCTAssertTrue(row(app, seedTitle).waitForExistence(timeout: 15))
        let paste = app.buttons["Paste"]
        XCTAssertTrue(paste.waitForExistence(timeout: 5))
        XCTAssertTrue(eventually { paste.isEnabled })
        paste.tap()
        XCTAssertTrue(eventually { self.items(app).count == 2 })
        snapshot(app, "08 pasted")
    }

    // MARK: Helpers

    @MainActor private func items(_ app: XCUIApplication) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(identifier: "item")
    }

    @MainActor private func row(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        items(app).matching(NSPredicate(format: "label == %@", title)).firstMatch
    }

    @MainActor private func button(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    @MainActor private func text(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    /// The destructive button in a confirmation dialog, wherever iOS presents it.
    @MainActor private func confirmButton(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        let inSheet = app.sheets.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
        if inSheet.exists { return inSheet }
        return app.buttons.matching(NSPredicate(format: "label == %@", label)).allElementsBoundByIndex.last ?? button(app, label)
    }

    @MainActor private func eventually(timeout: TimeInterval = 10, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    @MainActor private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
