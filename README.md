# stash

save any link and find it again. an iphone app by [gtfol](https://www.gtfol.dev).

| App | Source | Development |
| --- | --- | --- |
| iPhone | [apps/ios](apps/ios) | Open `apps/ios/Stash.xcodeproj` in Xcode |

The layout follows [capsule](https://github.com/gtfol/capsule) and [freewrite](https://github.com/gtfol/freewrite): each app keeps its own tools under `apps/`, so a later web app or sync service can sit beside the iPhone app without moving it. Neither exists yet.

## Checks

From `apps/ios`, run `swift test` and `scripts/test-ios.sh` (Xcode 26.6 and an iPhone simulator). GitHub Actions runs both, checks that the committed Xcode project matches its generator, and keeps UI test screenshots as an artifact.

See the [iPhone README](apps/ios/README.md) for setup, behavior, and design notes, and [verification](apps/ios/docs/verification.md) for what has been tested and the physical-device checklist.
