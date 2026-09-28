#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcodebuild -version
derived_data="${STASH_DERIVED_DATA:-DerivedData}"
result_bundle="${STASH_RESULT_BUNDLE:-TestResults-$(date +%Y%m%d-%H%M%S).xcresult}"
simulator_id=$(xcrun simctl list devices available --json | python3 -c '
import json, sys
runtimes = json.load(sys.stdin)["devices"]
for runtime in sorted(runtimes, reverse=True):
    if "iOS" not in runtime:
        continue
    for device in runtimes[runtime]:
        if device.get("isAvailable") and device["name"].startswith("iPhone"):
            print(device["udid"])
            sys.exit(0)
sys.exit("Install an iOS simulator runtime in Xcode Settings > Components.")
')
# Ad-hoc simulator signing (no Apple account) still embeds the App Group entitlement, which the
# share inbox needs. Device builds here are unsigned; use Xcode with a team to install on a phone.
xcodebuild -project Stash.xcodeproj -scheme Stash -destination 'generic/platform=iOS Simulator' -derivedDataPath "$derived_data" CODE_SIGN_IDENTITY=- build
xcodebuild -project Stash.xcodeproj -scheme Stash -destination 'generic/platform=iOS' -configuration Release -derivedDataPath "$derived_data" CODE_SIGNING_ALLOWED=NO build
xcrun simctl bootstatus "$simulator_id" -b
xcodebuild -project Stash.xcodeproj -scheme Stash -parallel-testing-enabled NO -destination "platform=iOS Simulator,id=$simulator_id" -derivedDataPath "$derived_data" -resultBundlePath "$result_bundle" CODE_SIGN_IDENTITY=- test
