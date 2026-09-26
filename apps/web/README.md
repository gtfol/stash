# stash for the web

Save a link in the browser and find it again. The same app as the iPhone version: paste or type a link, search, open, rename, delete.

Next.js 16 on Vercel, with the same stack as capsule and freewrite. Links are kept in the browser (IndexedDB) first, so stash works without an account and offline. Signing in with Google syncs them through the stash Supabase database to every browser you sign in on. The iPhone app doesn't sync yet; see [not in this version](#not-in-this-version).

## Develop

From `apps/web`:

```sh
npm install
npm run dev        # http://localhost:3000, guest mode unless .env.local configures sync
npm run lint
npm run typecheck
npm test           # unit tests; database tests too when TEST_DATABASE_URL is set
npm run build
npm run test:e2e   # after a build; needs E2E_DATABASE_URL
```

Database tests create and drop their own databases, so `TEST_DATABASE_URL` should point at a local Postgres you can do that in, such as `postgres://postgres:postgres@127.0.0.1:5432/postgres`. They're skipped without it, except in CI. `E2E_DATABASE_URL` is one disposable database that the browser tests fill with `db/schema.sql` and clear. The browser tests use Playwright's Chromium (`npx playwright install chromium`).

For sync locally, copy `.env.example` to `.env.local`, fill it in, and add `http://localhost:3000/api/auth/callback/google` to the Google client.

## Set up sync

stash works as a guest-only site with no configuration. Sync needs a database, a Google sign-in client, and five settings in Vercel.

### 1. Supabase project

1. In the [Supabase dashboard](https://supabase.com/dashboard), choose **New project**. Name it `stash`. Use its own project; don't share capsule's or freewrite's database.
2. Generate a database password and keep it in your password manager. It becomes part of `DATABASE_URL`.
3. Choose a region near where Vercel runs stash's functions. West US (Oregon) matches freewrite; if you pick it, set the Vercel project's function region to Portland (`pdx1`) under Settings → Functions.
4. If the form offers **Data API** or **only connection string**, choose only connection string. stash never uses Supabase's Data API or its browser keys.
5. When the project is ready, open **SQL Editor**, paste all of [`db/schema.sql`](db/schema.sql), and run it. It creates Better Auth's tables and stash's own, and turns on row level security with no policies, so the Data API can't reach any of them even if it's on. Running it again is safe.
6. Click **Connect**, choose **Transaction pooler** (port 6543), and copy the URI. Replace `[YOUR-PASSWORD]` with the database password. This is `DATABASE_URL`.
7. Under **Database → Settings → SSL Configuration**, download the certificate. Its full text, including the `BEGIN CERTIFICATE` and `END CERTIFICATE` lines, is `DATABASE_SSL_CA`.

Check it in the SQL editor: `select count(*) from stash_items;` returns 0, and the Table Editor lists `user`, `session`, `account`, `verification`, `stash_items`, `stash_accounts`, and `stash_request_limits`, each marked RLS enabled.

### 2. Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), use the project that holds capsule's sign-in, or a new one, and choose **Create credentials → OAuth client ID → Web application**. Name it `stash`.
2. **Authorized JavaScript origins**: `https://stash.gtfol.dev` (and `http://localhost:3000` for local development).
3. **Authorized redirect URIs**: `https://stash.gtfol.dev/api/auth/callback/google` (and `http://localhost:3000/api/auth/callback/google`).
4. Copy the client ID and secret. If the OAuth consent screen is still in testing, add the Google accounts that should be able to sign in as test users.

Sign-in works only on the address in `BETTER_AUTH_URL`. Preview deployments work as guest libraries, but Google refuses their changing addresses.

### 3. Vercel

1. In Vercel, choose **Add New → Project** and import `gtfol/stash` into the gtfol team. Name the project `stash`.
2. Set **Root Directory** to `apps/web`. The framework is detected as Next.js; leave the build and output settings as they are. `vercel.json` skips builds when a push doesn't change `apps/web`, so iPhone-only commits don't redeploy the site.
3. Under **Environment Variables**, add for Production. Mark the secrets as sensitive:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Supabase transaction pooler URI with the password |
   | `DATABASE_SSL_CA` | The Supabase certificate's PEM text |
   | `BETTER_AUTH_SECRET` | `openssl rand -base64 32`, unique to stash |
   | `BETTER_AUTH_URL` | `https://stash.gtfol.dev` |
   | `GOOGLE_CLIENT_ID` | From step 2 |
   | `GOOGLE_CLIENT_SECRET` | From step 2 |

   Add `DATABASE_URL`, `DATABASE_SSL_CA`, and `BETTER_AUTH_SECRET` to Preview too if previews should load page details: the details endpoint's rate limits are shared through the database, and without one a Vercel deployment answers "details are unavailable" rather than run unlimited.
4. Deploy, then add `stash.gtfol.dev` under **Settings → Domains** and follow Vercel's DNS instructions for gtfol.dev.
5. Production deploys from `main`. Until this work is merged there, the branch gets preview deployments only.

Changing a variable takes effect on the next deployment.

### 4. Check the deployment

- `https://stash.gtfol.dev/api/sync/status` returns `{"enabled":true}`. `false` means one of the database, secret, or Google variables is missing.
- The site opens with the Nature article, and the header offers **sign in**. **continue with google** returns signed in, with **synced** in the header.
- A second browser signed in to the same account shows the same links. A rename or deletion in one appears in the other after a reload or within a minute.
- In Supabase, `select count(*) from stash_items;` counts your links, including deleted ones' small tombstones.

## How it works

- **The same link rules as the iPhone app.** `src/lib/link.ts` ports `WebLink.swift`, and the tests use the iPhone app's test cases, so a page gets the same dedupe key on both. The saved link is kept exactly as entered and is what opening uses; tracking parameters and fragments only affect the dedupe key.
- **Browser first.** Every save, rename, and delete is one IndexedDB transaction. Guests have their own space; each account has another. The first account to sign in on a browser gets that browser's guest links once. Signing out shows the guest links again, and the account's copy stays in the browser for next time.
- **Sync never rejects an edit.** Each change is sent with the revision it was made on. When two browsers changed the same item, the server merges them: the latest title edit wins, the latest save time wins, newer details fill in without erasing older ones, and a deletion stands unless the page was saved again afterwards. The same page saved separately on two devices becomes one item under the first save's link and identity. `src/lib/item.ts` holds the merge rules; `src/lib/server/sync.ts` applies them in one transaction per request.
- **The first-launch article** (the Nature piece, opened through `https://archive.ph/GDsbC`) is added once per browser for guests and once per account, recorded in `stash_accounts`. It isn't copied from a guest library into an account, and once deleted it stays deleted everywhere.
- **Page details** are read by the server (`/api/details`), because browsers can't read other sites' pages. It reads at most 768 KB, stops after `</head>`, follows at most five redirects, connects only to public addresses (checked for every redirect, with no second DNS lookup), and is limited to 60 requests per 10 minutes per address. It answers only this site's own pages. Nothing is cached or stored on the server; details are saved with the item.
- **Preview images** load in your browser straight from the page's image host, without a referrer. Tiny or strangely shaped images are treated as none, and the row shows a letter instead.
- **Sharing into stash**: installed as an app (Add to Home Screen, or Install in Chrome), stash can appear in Android's share sheet. The shared link waits in the add field for one tap on **save**. The same works from a bookmarklet:

  ```js
  javascript:location.href='https://stash.gtfol.dev/?url='+encodeURIComponent(location.href)
  ```

  Pasting a link anywhere on the page, outside a text field, saves it straight away.

## Data and privacy

- Guests' links never leave the browser except for page-detail requests, which send the link to stash's server and nothing else, and preview images, which load from the page's own image host.
- Signed-in accounts store Google's name, email, and avatar URL (Better Auth's `user` table), sessions, and the account's items in the stash Supabase project. The browser never gets database credentials.
- No analytics, ads, or tracking. Pages are marked noindex.

## Not in this version

- The iPhone app syncing with the web library. The item format here is the iPhone app's `SavedItemRecord` with dates in milliseconds, plus `titleUpdatedAt`, `deletedAt`, and `mergedInto` for sync. A sync PR can add those to the iPhone record and call `/api/sync`.
- Export, and deleting an account from within stash. Until then, rows can be removed in Supabase (deleting a `user` row cascades to everything of theirs).
- Ratings, wishlists, feeds, a reader, and anything beyond saving and finding links.
