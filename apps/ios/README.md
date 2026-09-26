# stash

Save a link from anywhere on iPhone and find it again. This first version does one thing: save a URL, then search for it and open it.

Native SwiftUI + SwiftData, iOS 17+, iPhone only. Apple frameworks only: no packages, account, server, iCloud, analytics, or notifications. The only network requests are for link details and preview images.

## Build and run

1. Open `apps/ios/Stash.xcodeproj` in Xcode 26.6 or newer. The complete project is committed; nothing needs generating or installing.
2. Select the **Stash** scheme and an iPhone simulator, then run. A fresh install opens on one saved article (see [first-launch article](#the-first-launch-article)).
3. The share extension also works in the simulator: open a page in the simulator's Safari, tap share, and choose **stash**.

### On a physical iPhone

Signing and the App Group can't be set up from this repository:

1. In Xcode, select the **Stash** target → Signing & Capabilities, then the **StashShare** target. Both default to the gtfol, LLC team (`J59ZSG67SJ`), as freewrite does. If you aren't on that team, choose your own for both targets.
2. `dev.gtfol.stash` (app) and `dev.gtfol.stash.share` (extension) are working bundle IDs, not registered or settled App Store identifiers. To change them, edit `BUNDLE_ID` in `scripts/generate-project.py`, run `python3 scripts/generate-project.py`, and commit the result. The extension ID, App Group, and tests derive from it.
3. Both targets carry the App Group `group.dev.gtfol.stash`, a placeholder. With automatic signing, Xcode registers it when you build for a device with a team selected; otherwise add it under Apple Developer → Certificates, Identifiers & Profiles → Identifiers → App Groups and enable it for both App IDs. Under Signing & Capabilities, **App Groups** should show the group checked, without errors, on both targets. To use a different group, change `APP_GROUP` in the generator and regenerate. The code reads the ID from each target's Info.plist (`StashAppGroupIdentifier`), so there is no second copy.
4. Run on the phone, then share a page from Safari. If stash isn't in the share sheet's app row, scroll to **More** and enable it.

If the App Group isn't provisioned, the share card says “stash can’t receive shares until its app group is set up. nothing was saved.” instead of claiming success.

## Using stash

- **Paste**: copy a link, open stash, and tap **Paste** in the bottom bar. This is the system paste control: it reads the clipboard only when tapped, so iOS shows no permission prompt. iOS draws its label, which is why “Paste” is the one capitalized word in the app.
- **type a link**: type or paste into the field. A bare domain such as `example.com/article` is shown as “saves as https://example.com/article” before saving.
- **Share**: from Safari or any app that shares a URL, or text containing one link, choose stash. A small card says “saved to stash” only after the link is written to disk, then closes itself. The app brings the link into the library the next time it opens or returns to the foreground.
- **Open**: tap a row to open its saved link in the browser (or in an app that handles that link, as iOS does everywhere).
- **Details**: the ⓘ button shows the title, source, author and date when known, a preview when reliable, the exact saved link, the publisher's original link when known (for reference only), when it was saved, and whether details loaded. Edit the title there; leave it empty to return to the page's title.
- **Search** matches every word against titles, source, domain, and link, ignoring case and accents.
- **Delete** from details, by swiping left, or from the long-press menu. Each asks first.

The bottom bar reports what happened: “saved.”, “already saved. moved to the top.”, “saved. details will load when you’re back online.”, or why nothing was saved. While offline it says links still save and details load later. A row whose details haven't arrived shows its domain and path as the title, with “fetching details…”, “offline”, “site blocks previews”, or a similar note beside the domain. Rows are never blank.

## How saving works

### The link, exactly as given

- Accepted: exactly one explicit `http` or `https` URL. In shared or pasted text, only links written with `http(s)://` count, so bare domains in a sentence are never guessed at. Two different links mean nothing is saved (“share one link at a time”). Other schemes (`ftp`, `mailto`, `file`, `javascript`, …) are refused by name.
- The trimmed link is stored verbatim and is what opens. Nothing replaces it: not a canonical URL, a redirect target, or a publisher's original.
- Duplicates are found with a separate dedupe key: https, lowercase host without `www.`, no default port, no trailing slash, no fragment, and no tracking parameters (`utm_*`, `fbclid`, `gclid`, `mc_*`, `igshid`, and similar, plus share parameters such as `si` on YouTube and Spotify or `s`/`t` on X). Meaningful parameters (`?v=`, `?id=`, `?p=`, `?page=`) and route-like fragments (`#/inbox`) are kept, and path case is preserved. Saving the same page again moves the existing item to the top by updating `lastSavedAt`. Its original link, title, and details don't change.

### Share extension and inbox

The extension never opens the database and never fetches the page. For each share it writes one JSON record (`version`, `id`, `url`, `sharedAt`) into `Inbox/` in the App Group container: first to a hidden `.partial` file, flushed with `fsync`, then renamed atomically to `<milliseconds>-<uuid>.json`, after which the directory itself is flushed. Only then does the card say saved.

The app imports on launch and whenever it returns to the foreground. All complete records go into the database in one save; only after that save succeeds are the records deleted. If the app is stopped midway, the records remain and are imported again next time. Importing a record twice changes nothing, because a repeat save only moves `lastSavedAt` forward to that share's time. An undecodable record is renamed `.unreadable` so it can't block later shares; a record from a newer app version is left for that version. Only the app ever writes the database, so SwiftData never has two writers.

### Details

- Saving never waits for details. After a save, stash reads the start of the page: at most 768 KB, stopping at `</head>`, with a 15-second request timeout, no cookies or cache, and over https as App Transport Security requires. The saved `http` link still opens as saved. It reads `<title>`, Open Graph, Twitter, citation and Dublin Core tags, the canonical link, and JSON-LD articles for the title, description, preview image URL, site name, author, publication date, and canonical URL.
- Apple's LinkPresentation is asked for a title when that read is refused or finds none. It isn't the first request because it provides only a title and image data, with no description, site, author, date, or canonical link. Its subresource downloads are turned off.
- Bot checks and consent walls (“Just a moment…”, “Access denied”) count as a blocked site, not as titles.
- Up to three fetches run at once. They're cancelled when stash goes to the background and resume later. Transient failures (offline, timeout, unreachable, server error) are retried automatically up to three times, and when the connection returns; offline attempts don't count against that limit. Blocked sites, missing pages, and non-web pages aren't retried automatically. **try again** / **refresh details** always retries.
- A preview image is shown only if it downloads (up to 5 MB), decodes, is at least 64 px on its short side, and is no thinner than 4:1. Otherwise the row shows the site's first letter and the details screen shows no image. Downloaded previews are cached on disk by `URLCache`.
- No article text is downloaded or stored, and there is no offline reading.

### Who owns each field

`SavedItemRecord` keeps details in layers, so a refresh can't overwrite anything it doesn't own:

- `customTitle` belongs to the user. Refreshes never touch it.
- `known` holds details supplied with an item: the first-launch article's title, source, author, date, and original link. Fetches never replace or blank them.
- `page` holds fetched details. A refresh replaces a field only with a newer non-empty value.

The title shown is the user's, then the known one, then the page's, then the link's domain and path.

### The first-launch article

On first launch, unless the library already holds it (as the archive or the Nature link), stash adds one item: “How to make a brain: new experiments challenge existing picture”, source Nature, author Lynne Peeples, published September 18, 2026. Its saved link, and what **open link** opens, is `https://archive.ph/GDsbC`. The publisher's page, `https://www.nature.com/articles/d41586-026-02943-1`, is kept as `originalURL` for attribution only.

A marker in UserDefaults is set after the article is stored and never cleared. Deleting the article, clearing the store, or replacing the database in a later migration never brings it back. Reinstalling the app is a fresh install and shows it once again.

## Data and privacy

- The library is a SwiftData store at `Application Support/stash.store`, with CloudKit disabled. Shared links wait in the App Group container only until imported. Preview images are cached under `Caches`.
- The only requests go from your phone to the sites you save, for their pages and preview images. There is no stash server, account, analytics, or tracking. Sites see those requests as they would a visit, without cookies.
- Privacy manifests declare UserDefaults (`CA92.1`, the first-launch marker) and file timestamps (`C617.1`, removing abandoned inbox files); no data is collected and nothing tracks.
- iOS may include the library in device backups. There is no app-level sync.

## Design

The interface follows gtfol's shared design standard ([DESIGN.md in gtfol/ai](https://github.com/gtfol/ai/blob/main/DESIGN.md)) and the capsule and freewrite iPhone apps. gtfol/ai is written guidance, not a token package, so the values live in `Stash/UI/Interface.swift`:

- **Palette**: black canvas, `#eeeeee` text, `#aaaaaa` secondary text, and `#2c2c2c` hairlines, which are the standard's dark tokens and match capsule's `CapsuleStyle`. `#111111` (the standard's hover surface) fills preview tiles, and `#ef9696` (its dark error token) marks errors, always with words.
- **Type**: Lato Regular, bundled under the SIL Open Font License (the same file as capsule and freewrite), scaled with Dynamic Type: 13 pt captions, 15 pt interface text, 17 pt titles, 22 pt on the details screen.
- **Layout**: 20 pt gutters, 44 pt touch targets, an open list with hairlines, and no cards. One filled button per screen, capsule's light-on-black with 2 pt corners. Text actions, line icons, and lowercase copy.
- **Dark only**, like capsule, set in Info.plist and SwiftUI. The standard's light tokens are there if a light theme is wanted later.
- **Bottom bar**: freewrite's quiet bottom toolbar and capsule's text navigation informed it. stash has one screen, so the bar holds the add actions instead of tabs.
- **Icon**: a lowercase “s” in Lato, `#eeeeee` on black, in the manner of capsule's “c” and freewrite's “f”, drawn by `scripts/make-icon.swift`.

Deliberately left out: capsule's camera and photo pipeline, API client, sign-in and Keychain, PostHog analytics, wardrobe models, category grid, product cards, and fashion imagery; freewrite's timer and dictation toolbar and its light appearance.

## Tests

From this directory:

```sh
swift test
scripts/test-ios.sh
```

`swift test` runs the Foundation-only core on macOS: link parsing and dedupe keys, the inbox, shared payloads, the HTML parser and extractor (against a stubbed network), metadata merging, the first-launch article, and search. `scripts/test-ios.sh` builds the simulator app and an unsigned Release device build, then runs the unit tests (including the SwiftData store tests) and UI tests on an iPhone simulator. UI tests start the Debug build with `-StashUITestReset` to get a fresh install, and attach screenshots to the result bundle. Each run writes a `TestResults-*.xcresult`.

See [verification](docs/verification.md) for results and the physical-iPhone checklist.

## Project layout

- `Stash/Core`: Foundation only, and tested on macOS: `WebLink`, `ShareInbox`, `SharedPayload`, `LinkMetadata`, the HTML parser and extractor, `SavedItemRecord`, and `AppConfiguration`. The extension compiles the four files it needs.
- `Stash/Persistence`: the `SavedItem` model and `SavedItemStore`, the only writer.
- `Stash/App`: app entry, `LibraryModel`, `MetadataRefresher`, the LinkPresentation-backed extractor, and preview loading.
- `Stash/UI`: the library, add, and details screens and shared style.
- `StashShare`: the share extension.
- `StashTests`, `StashUITests`: unit and UI tests.
- `scripts/generate-project.py`: a standard-library-only generator for `Stash.xcodeproj` and both entitlements files. Identifiers live at its top; CI checks the committed project matches it.

The seams are `SavedItem`, `LinkMetadataExtractor`, `ShareInbox`, and `SavedItemStore`. `SavedItemRecord` is the `Codable` shape for a later export or sync service, with a stable UUID and created, last-saved, and updated times. Nothing is exported or synced yet.

## Not in this version

Ratings and reviews, wishlist states, special handling for movies, books, or maps, capsule imports, saved article text or an offline reader, summaries, recommendations, accounts, sharing with other people, a web app or server, and iPad or Android.
