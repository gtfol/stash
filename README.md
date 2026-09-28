# stash

save any link and find it again. an iphone app and a web app by [gtfol](https://www.gtfol.dev).

| App | Source | Development |
| --- | --- | --- |
| iPhone | [apps/ios](apps/ios) | Open `apps/ios/Stash.xcodeproj` in Xcode |
| Web | [apps/web](apps/web) | `npm install && npm run dev` in `apps/web`; deployed by Vercel from `apps/web` |

The layout follows [capsule](https://github.com/gtfol/capsule) and [freewrite](https://github.com/gtfol/freewrite): each app keeps its own tools under `apps/`. The web app syncs signed-in libraries through the stash Supabase database; the iPhone app keeps its library on the phone for now.

## Checks

- iPhone: from `apps/ios`, run `swift test` and `scripts/test-ios.sh` (Xcode 26.6 and an iPhone simulator). GitHub Actions runs both, checks that the committed Xcode project matches its generator, and keeps UI test screenshots as an artifact.
- Web: from `apps/web`, run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`. GitHub Actions runs them against Postgres 16 and keeps the browser tests' screenshots as an artifact.

See the [iPhone README](apps/ios/README.md) and [verification](apps/ios/docs/verification.md), and the [web README](apps/web/README.md) for Supabase, Google, and Vercel setup and [its verification](apps/web/docs/verification.md).
