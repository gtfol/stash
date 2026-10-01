# stash

Save any link and find it again: an iPhone app in `apps/ios` and a web app in `apps/web`, by gtfol.

Read [HANDOFF.md](HANDOFF.md) first. It covers the current state, the services behind the live site, how to run and test both apps, and what hasn't been done. Then read the README of the app you're changing.

- Link and dedupe rules are implemented twice, in `apps/ios/Stash/Core/WebLink.swift` and `apps/web/src/lib/link.ts`, with shared test cases. Change them together.
- The Xcode project is generated: edit `apps/ios/scripts/generate-project.py`, regenerate, and commit both.
- `apps/web` uses Next.js 16. Read `apps/web/AGENTS.md` before changing framework code.
- User-facing copy is lowercase.
- Never commit secrets or edit `.env*` files without asking.
