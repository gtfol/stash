# stash handoff

State of the project on October 1, 2026, for whoever picks it up next. Start here, then read the app READMEs for detail.

## What stash is

Save any link and find it again. Two apps in one repo, both by gtfol, with lowercase user-facing copy:

| App | Path | Status |
| --- | --- | --- |
| iPhone (SwiftUI + SwiftData, iOS 17+) | `apps/ios` | Built and tested in CI on simulators. Never run on a physical iPhone. Library stays on the phone; no sync yet. |
| Web (Next.js 16 on Vercel) | `apps/web` | Live at https://stash.gtfol.dev. Works as a guest library in the browser. Google sign-in and sync through Supabase are switched on but haven't been used in production yet. |

The one feature in both: save a link (paste, type, or share), see it in a library newest-first, search, open the saved link, rename, delete with confirmation. Page details (title, site, author, date, preview image) load in the background and never block a save.

## Where things live

### Repository

- GitHub: `gtfol/stash`, default branch `main`. PR #1 (both apps) and PR #2 (Vercel fix) are squash-merged. They came from the branch `claude/upbeat-gauss-ihxobm`, which also carries this handoff; once that's merged, start new work from `main` on a fresh branch.
- CI (`.github/workflows`):
  - `ios.yml` runs on pushes touching `apps/ios/**`, on `macos-26` with Xcode 26.6: Swift package tests, generated-project check, simulator and device builds, unit and UI tests, screenshots as artifacts.
  - `web.yml` runs on pushes touching `apps/web/**`, on Ubuntu with Postgres 16: lint, typecheck, unit and database tests, build, Playwright browser tests, screenshots as artifacts.
- Docs: `README.md`, `apps/ios/README.md`, `apps/ios/docs/verification.md` (includes the physical-iPhone checklist), `apps/web/README.md` (Supabase, Google, and Vercel setup), `apps/web/docs/verification.md`.

### Services (no secrets here; values live in the dashboards)

| Service | What's set up |
| --- | --- |
| Vercel | Team `gtfol` (`team_H0hmVWuYlQtVnqNzjU9O8hu1`), project `stash` (`prj_rpg7q4Rgz1OvYLdxUDkKzweIb4Ye`). Root Directory `apps/web`, Node 24, functions in Portland (`pdx1`). Production deploys from `main`; domain `stash.gtfol.dev`. Vercel Authentication protects every URL except the custom domain. |
| Vercel env (Production only) | `DATABASE_URL` (Supabase transaction pooler, port 6543), `DATABASE_SSL_CA`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (`https://stash.gtfol.dev`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. All sensitive except `BETTER_AUTH_URL`. Preview deployments have none, by design (see below). |
| Supabase | Project `stash`, West US (Oregon, `us-west-2`), created with the Data API off and automatic RLS on as recommended. `apps/web/db/schema.sql` has been run. Both were reported by Allen, not checked by an agent. The Supabase connector used so far only saw the `freewrite` organization, so an agent couldn't read this project; get access before debugging the database. |
| Google OAuth | Web client `stash` in the Google Cloud project named **freewrite**, which also holds capsule's and freewrite's clients. Redirect URI `https://stash.gtfol.dev/api/auth/callback/google`. The consent screen shows that project's branding, not "stash". |
| Apple | Bundle ID `dev.gtfol.stash` and App Group `group.dev.gtfol.stash` are placeholders, not registered. Team `J59ZSG67SJ` (gtfol, LLC) is the default in the Xcode project generator. |

Side change outside this repo: freewrite's Vercel functions were moved to Portland (`pdx1`) on September 29 to sit next to its Oregon database. It takes effect on freewrite's next deploy, which hadn't happened at handoff.

## How it works, briefly

- **Shared link rules.** `apps/ios/Stash/Core/WebLink.swift` and `apps/web/src/lib/link.ts` implement the same rules, and both test suites use the same cases. A saved link is kept exactly as entered and is what opening uses. A separate dedupe key (https, lowercase host without `www.`, no default port or trailing slash, tracking parameters and fragments removed, route-like fragments kept) decides whether two saves are the same page. Change both platforms together.
- **One record shape.** iOS `SavedItemRecord` and web `SavedItem` (`apps/web/src/lib/item.ts`) hold the same fields. The web adds `titleUpdatedAt`, `deletedAt`, and `mergedInto` for sync and stores dates as milliseconds. Details are layered: `customTitle` belongs to the user, `known` to whoever supplied the item, and `page` to detail fetches. Fetches never touch `url`, `known`, or the user's title.
- **First-launch article.** Each new install (iOS), browser (web guest), and account (web, recorded in `stash_accounts`) starts with one saved article: the Nature piece "How to make a brain…", opened through `https://archive.ph/GDsbC`. It is never re-added after deletion.
- **Web storage and sync.**
  - Browser first, in IndexedDB (`apps/web/src/lib/local-db.ts`), with a guest space and one space per account.
  - The first account to sign in on a browser gets that browser's guest links once.
  - `/api/sync` (`apps/web/src/lib/server/sync.ts`) pushes pending items and pulls by revision. It merges concurrent edits instead of rejecting them:
    - the latest title edit wins;
    - the latest save time wins;
    - newer details fill in without erasing older ones;
    - a deletion stands unless the page was saved again afterwards;
    - the same page saved on two devices becomes one item under the first save.

  Postgres enforces one live item per page per account.
- **Page details.**
  - **iPhone:** the phone fetches details itself, with a LinkPresentation fallback.
  - **Web:** `/api/details` on the server fetches them. It reads at most 768 KB, stops after `</head>`, and connects only to public addresses, re-checked on every redirect. It's rate limited to 60 requests per 10 minutes per IP through Postgres. On Vercel it answers 503 when there's no database, rather than run unlimited; that's why previews never load details.
- **Accounts.** Better Auth with Google only (`apps/web/src/lib/server/auth.ts`). All tables have RLS with no policies and no grants for Supabase's `anon` or `authenticated` roles. The server connects as the table owner with `DATABASE_URL`.

## Running and testing

### Web (`apps/web`)

```sh
npm install
npm run dev                      # guest mode unless .env.local configures sync
npm run lint && npm run typecheck
TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/postgres npm test   # 48 tests; database tests create and drop their own databases
npm run build
E2E_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/stash_e2e npm run test:e2e   # 5 Playwright tests against the production build
```

- Next.js 16 differs from older versions; read `node_modules/next/dist/docs/` before changing framework code (`apps/web/AGENTS.md`).
- `@playwright/test` is pinned to 1.56.1, which matches Chromium build 1194.
- The browser tests sign in by writing a Better Auth session row and signed cookie, not through Google.

### iPhone (`apps/ios`)

- `swift test` runs the core tests on a Mac. `scripts/test-ios.sh` builds for simulator and device and runs all tests (Xcode 26.6).
- `Stash.xcodeproj` is generated by `scripts/generate-project.py`. Edit the generator, regenerate, and commit both; CI fails if they differ.
- The UI tests (`StashUITests`) launch with `-StashUITestReset` for a fresh install.

### Agent environment notes

From the cloud sessions that built this:
- There was no local Swift toolchain, so all iPhone verification ran on GitHub Actions. Screenshots come from the `ios-screenshots` artifact.
- The network proxy blocked `api.vercel.com`, `*.gtfol.dev`, archive.ph, nature.com, and most third-party sites. Vercel was managed through the Vercel connector. Real pages' details were never fetched successfully from the sandbox.
- Postgres 16 and Playwright's Chromium were available locally (`pg_ctlcluster 16 main start`).

## What hasn't been done

### 1. Verify the launch (do this first)

- [ ] **Google sign-in on production.**
  - Sign in at stash.gtfol.dev, confirm the header says **synced**, then sign in on a second browser and check the same links appear.
  - As of handoff, production logs show no sign-in, sync, or details requests.
- [ ] **Database from Vercel.** The first sign-in or details request is the first real connection.
  - Runtime errors mentioning TLS or certificates point at `DATABASE_SSL_CA`.
  - Authentication errors point at the password in `DATABASE_URL`. Characters such as `@` must be URL-encoded.
  - A missing table means `schema.sql` didn't run.
  - Check rows in Supabase: `user`, `session`, `stash_items`, `stash_accounts`.
- [ ] **Page details in production.** Save a few real article links and confirm titles and previews load. Only fixtures have been parsed so far.
- [ ] **Physical iPhone.** Work through `apps/ios/docs/verification.md` → Physical iPhone checklist, after registering the App Group with a real team: signing, share extension from Safari and other apps, offline, VoiceOver, large text.
- [ ] **Browsers.** Safari and Firefox, screen readers, and very long libraries haven't been tried on the web.

### 2. Features deliberately left out of the first version

- **iPhone ↔ web sync.** The biggest next step.
  - Add `titleUpdatedAt`, `deletedAt`, and `mergedInto` to `SavedItemRecord` and the SwiftData model. That needs a migration and must keep the seed-once rule.
  - Add Google sign-in on iOS. capsule's iOS app signs in through a web handoff: see `/api/scan/*` in the gtfol/capsule repo.
  - Call `/api/sync` with the same request shape (`apps/web/src/lib/sync-types.ts`) and port the merge and rebase rules (`mergeItems`, `applySyncResponse`).
  - The share-extension inbox and dedupe rules stay as they are.
- **Account deletion and data export** on the web. Apple requires in-app account deletion once the iPhone app has accounts. Until then, deleting a `user` row in Supabase cascades to everything of theirs.
- **Privacy policy and terms pages.** capsule has `/privacy` and `/terms` to follow.
- **Product scope beyond saving links**, per the repo description "Save what you find, rate what you love, and track what you want": ratings and reviews, wishlist states, special handling for movies, books, and maps, capsule imports, saved article text or a reader, summaries, recommendations, sharing with other people, iPad and Android.

### 3. Loose ends and decisions to revisit

- **Google consent screen.** It shows the "freewrite" Cloud project's branding. A separate Cloud project would show "stash"; it's a choice, not a bug.
- **Preview deployments.**
  - They have no environment variables, so they run as guest libraries without page details.
  - Google sign-in can't work on previews anyway, because the redirect URI is fixed.
  - Adding the database variables to Preview would turn details on there.
- **Builds on every push.** iPhone-only commits now also rebuild the web app; a build-skip rule was removed because it also blocked redeploys after settings changes. If build minutes matter, find a skip that leaves manual redeploys alone.
- **Deleted items.** Tombstones in `stash_items` are kept forever, holding no URL or title, only identity and dates. A cleanup job could remove old ones once every device has synced.
- **Apple placeholders.** Register the bundle ID and App Group, and settle the App Store identifiers before any TestFlight build.
- **Lint warning.** `eslint@9` reports a deprecation warning during install; upgrade alongside `eslint-config-next`.
- **Commit attribution.** The very first commit on `main` ("initial commit") carries agent attribution lines that later commits leave out. Rewriting history isn't worth it.

## How work was done here

- Changes went through PRs to `main`, and CI had to be green before merging.
- Commit messages are short, comma-separated lists of changes, with no agent attribution or co-author lines.
- Substantial changes were planned and agreed with Allen before starting.
- UI follows gtfol's design standard (`DESIGN.md` in gtfol/ai): white or black canvas, Lato, thin dividers, text-first controls, light and dark themes. Rendered screens were checked by screenshot after every UI change.
- Secrets never go in the repo, logs, or chat. `.env*` files are gitignored, and agents should ask before editing them.
