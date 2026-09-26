# verification

## PR1: save any link — September 26, 2026

Nothing here has run on a physical iPhone yet. Everything below ran on GitHub Actions `macos-26` runners with Xcode 26.6, because the session that wrote this PR had no Mac. [Run 5](https://github.com/gtfol/stash/actions/runs/36210844166) is the reference.

### Automated checks

- The generated `Stash.xcodeproj` and entitlements match `scripts/generate-project.py`. Regenerating is deterministic.
- `swift test`: 35 core tests passed on macOS, compiled in Swift 6 language mode with complete strict concurrency and no warnings.
- `scripts/test-ios.sh`: the Debug simulator build and the unsigned Release device build succeeded with warnings treated as errors, including the share extension. **51 tests passed** on an iPhone 17 Pro simulator (iOS 26.5): the 35 core tests, 9 SwiftData store tests, 4 library-model tests, 1 preview-image test, and 2 UI tests.
- `swift scripts/make-icon.swift` renders an icon matching the committed `AppIcon.png`: mean difference 0.5/255, same glyph bounds within 1 px.

### Acceptance checks

| Check | How it was verified |
| --- | --- |
| Fresh install shows the Nature article once, with the archived link; relaunch adds no copy; deleted, it stays deleted | UI test `testFirstLaunchSaveSearchRenameAndDelete` (fresh install, details show `https://archive.ph/GDsbC` and the Nature link as reference, relaunch, delete, relaunch); store tests for seeding once, after deletion, with a replaced store, and when the article is already saved |
| Opening it goes to the archive, not Nature | The row and **open link** open the saved `url` field, which store and record tests show stays `https://archive.ph/GDsbC` through refreshes. Safari opening it is not automated; see the device checklist. |
| A pasted link saves immediately, survives relaunch, opens even if metadata fails; later metadata fills only unedited fields | UI tests for typed and pasted links (both saved before any details; the test pages returned 404 and stayed readable as “page not found”), relaunch in the UI test, store reopen test, library-model tests for saving before details and for a blocked site, record and store tests for the user's title surviving refreshes |
| Shares confirm only after a durable write; the item appears once, even after an interrupted import or two shares of the same link | Inbox tests (atomic, uniquely named records; partial files ignored; newer versions left alone), store tests (two shares of one page make one item; re-importing an already imported record changes nothing; bad records set aside), library-model test importing on becoming active. The extension's own UI and Safari handoff are **not** automated. |
| Search, title edit, delete; failed image or metadata doesn't blank a row or lose the link; unsupported schemes are refused clearly | UI test (search and “no matches”, rename, delete with confirmation, `ftp` refused with its reason), record tests (fallback titles, search), preview-image test (tracking pixels, banners, and non-images rejected), link tests |
| Tests for extraction and normalization, dedupe, one-time seed, inbox retry, and metadata merge | `WebLinkTests`, `SharedPayloadTests`, `StoreTests`, `ShareInboxTests`, `MetadataTests`, `ExtractorTests`, `LibraryModelTests` |

### Rendered screens

Screenshots from the UI tests were reviewed at 1x: the dark library with the first-launch article (“Nature · archive.ph · Sep 26”, an “n” tile), details, the add sheet refusing `ftp`, search with no matches, the delete confirmation, and the enabled **Paste** control (light, with black text) saving a clipboard link. The simulator's network reached archive.ph, which refused the preview request as expected (“this site doesn’t allow previews.”); the known title, source, author, and date stayed. They led to three fixes: list hairlines now start at the gutter, only between items; deleting now asks with an alert, because iOS 26 shows a confirmation dialog as a popover anchored to its source view, which floated from the top of the details screen and, once anchored to the button, didn't reliably appear; and the blocked-site note no longer suggests editing a title the item already has.

### Not verified

- Anything on a physical iPhone: signing, the App Group under a real team, sharing from Safari or other apps (including offline), the extension's memory and time budget, and how iOS presents the extension's card.
- Real pages' details and previews beyond those two refusals. The parser was tested on fixtures shaped like Nature's markup.
- The LinkPresentation title fallback. It needs the network and isn't covered by tests.
- Colors in the screenshots, which were reduced to 24 colors for review. Error text is `#ef9696` in code.
- VoiceOver, the largest text sizes, and smaller iPhones.

## Physical iPhone checklist

Use an iPhone on iOS 17 or newer, with the team and App Group set up as described in the [README](../README.md#on-a-physical-iphone). Tick each item and note the iOS version and model.

**Setup**

- [ ] Under Signing & Capabilities, **Stash** and **StashShare** both show the same team and the App Group `group.dev.gtfol.stash` checked, with no errors.
- [ ] A fresh install launches to the dark library with no onboarding.

**First-launch article**

- [ ] The library shows “How to make a brain: new experiments challenge existing picture”, once, with “Nature · archive.ph” beneath it.
- [ ] ⓘ shows the link `https://archive.ph/GDsbC`, the original `https://www.nature.com/articles/d41586-026-02943-1` marked as reference, and “Lynne Peeples · Sep 18, 2026”.
- [ ] Tapping the row, and **open link** in details, open archive.ph in the browser, not nature.com.
- [ ] Force-quit and relaunch: still one copy. Delete it (confirm), force-quit, relaunch: it stays deleted.

**Saving in the app**

- [ ] Copy an article link in Safari, open stash, tap **Paste**: no permission prompt, the item appears at the top at once with “saved.”, and its title and preview fill in shortly after.
- [ ] Turn on airplane mode, copy another link (from Notes or Messages), and paste: it saves, the bar says details will load when you're back online, and the row shows its domain and path with “offline”. Turn airplane mode off with stash open: details fill in without relaunching.
- [ ] Force-quit and relaunch: both items remain and open.
- [ ] Edit a title, then **refresh details**: your title stays. Clear the title and save: the page's title returns.
- [ ] **type a link**: `example.com/page` shows “saves as https://example.com/page”; `ftp://example.com` and `mailto:someone@example.com` are refused by name and nothing is saved.
- [ ] Paste the same article with `?utm_source=test` added: “already saved. moved to the top.”, no duplicate, and details still show the first link.

**Share extension**

- [ ] Safari, online: share → stash. A small card says “saved to stash” with the domain and closes itself in about a second. Open stash: the item is there once, and its details load.
- [ ] Safari, in airplane mode: the card still says saved. Open stash (still offline): the item is there, marked offline; details load once back online.
- [ ] Share the same page twice, then open stash: one item.
- [ ] Share two different pages, then open stash and force-quit it immediately; reopen: each appears once.
- [ ] From Notes, share text containing one link: saved. Text with two different links: “more than one link found. nothing was saved.”. Text with no link: “no link found. nothing was saved.”. Each error stays until you tap **close**.
- [ ] Share from at least two other apps (for example Messages, YouTube, X, Photos): links save; a photo either doesn't offer stash or explains no link was saved.
- [ ] While the card shows, the host app stays visible behind it; note how the sheet looks on this iOS version.

**Library**

- [ ] Search finds items by title words, site name, domain, and part of the link; “no matches” shows otherwise.
- [ ] Delete by swiping left, from the long-press menu, and from details: each asks first; cancel keeps the item.
- [ ] A page that blocks previews keeps a readable title (its domain and path), says why details are missing, and its title can be edited.
- [ ] VoiceOver: a row reads its title, then source, domain and date, with the hint that it opens in the browser and a “details” action; **Paste** and the ⓘ buttons are announced.
- [ ] Largest accessibility text size: the bottom bar stacks, rows wrap, and nothing is cut off.

Physical-device behavior of the share sheet, iOS clipboard policy, offline radio states, VoiceOver, and real sites' metadata can only be confirmed on the phone.
