# verification

## Web app and sync — September 26, 2026

Nothing here has run against the real stash Supabase project, Google sign-in, or Vercel yet. Everything below ran in the development container (Node 22, Postgres 16.13, Chromium 141 from Playwright 1.56.1) and in GitHub Actions (Node 24, Postgres 16): [Web checks run 1](https://github.com/gtfol/stash/actions/runs/36233924853) passed all 48 tests with none skipped and all 5 browser tests, and keeps their screenshots as an artifact.

### Automated checks

- `npm run lint` and `npm run typecheck`: clean, with React Compiler lint rules.
- `npm test`: 48 tests. Link rules with the iPhone app's own test cases (dedupe keys, schemes, typed and shared links); the metadata parser with the iPhone parser's fixtures; items, merging, and the first-launch article; the details reader, fetch safety (private addresses, redirects, bounded reads), and rate limits; browser storage in fake IndexedDB; and, against Postgres, the schema, Better Auth's own schema check, sync, and a full browser-to-server round trip.
- `npm run build`: the production build succeeds.
- `npm run test:e2e`: 5 browser tests against the production build and Postgres. A guest saves, finds, renames, and deletes; paste-anywhere; a shared link waiting in the add field; two signed-in browsers (desktop and iPhone-sized) syncing a guest library, a duplicate save, a rename, and a deletion, then signing out; dark theme at 375 px.

### Acceptance checks

| Check | How it was verified |
| --- | --- |
| The Nature article appears once, with the archive link; deleted, it stays deleted | Browser test (guest: details show `https://archive.ph/GDsbC`, the Nature link for reference, and the byline; delete and reload), storage test (once per browser), database test (once per account, not re-added after deletion, not added when the account already has the article) |
| Saving is immediate and never waits for details; the saved link opens as entered | Browser tests (typed, pasted, and shared links; row and **open link** hrefs are the saved link) |
| One item per page, on one device and across devices | Storage and browser tests (`already saved. moved to the top.`); database tests and the two-browser test (the same page saved separately on two devices becomes one item under the first save) |
| Edits made in two places are merged, not lost | Database tests (a rename and a detail refresh on the same revision; a deletion against a stale rename and a stale re-save), round-trip test, two-browser test |
| Accounts are private; Supabase's API can't read the tables | Database test (another account sees nothing; the `anon` and `authenticated` roles get permission denied) |
| Details can't reach private networks and are bounded | Fetch safety tests (addresses, alternate IP spellings, redirects re-checked, DNS pinned, reads stop after `</head>` or 768 KB) |
| Unsupported schemes are refused by name | Link tests, browser test (`ftp` refused, nothing saved) |

### Rendered screens

Screenshots from the browser tests were reviewed at desktop and phone widths, light and dark. They led to three fixes: text fields showed a focus box on top of their underline, the delete confirmation opened in the top-left corner instead of the middle, and search had the browser's own blue clear button (now a quiet **clear**). Typing a new link now clears an earlier error so the "saves as" preview isn't hidden.

### Not verified

- Google sign-in end to end. The browser tests sign in with a session made the way Better Auth makes them, not through Google.
- The real Supabase project: its pooler, certificate, and latency from Vercel.
- A Vercel deployment, the `stash.gtfol.dev` domain, and the build-skip rule in `vercel.json`.
- Real pages' details. This container's network doesn't reach other sites directly, so every fetch here came back refused, which the app showed as "site blocks previews". The parser was tested on fixtures.
- Android's share sheet (installed web app), Safari, Firefox, screen readers, and very long libraries.
