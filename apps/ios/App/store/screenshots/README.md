# App Store screenshots

Apple requires screenshots for at least:

| Display | Device class | Pixel size (portrait) |
|---|---|---|
| 6.9" / 6.7" iPhone | iPhone 16 Pro Max / 15 Pro Max | 1320 × 2868 (or 1290 × 2796) |
| 13" iPad (only if you ship iPad) | iPad Pro 13" | 2064 × 2752 |

Other sizes are auto-scaled by App Store Connect from these, so you only need the
largest of each family. Provide 3–10 per size. Suggested set (one screen each):

1. **Mine** — the current triangle + "Mine triangle" (the core loop).
2. **Map** — the oasis/desert depletion overlay.
3. **Wallet** — owned slot NFTs with the landlord badge.
4. **Marketplace** — active listings.
5. **Privacy** — "your location never leaves the device" messaging.

## Capture them automatically (recommended)

Screenshots are produced deterministically with `fastlane snapshot`:

```sh
brew install fastlane xcodegen
cd apps/ios/App
fastlane snapshot init          # drops SnapshotHelper.swift into the repo (one-time)
# add SnapshotHelper.swift AND ScreenshotUITests.swift (below) to the
# StepAppUITests target in project.yml's Tests path, then:
fastlane ios screenshots        # writes ./fastlane/screenshots/<lang>/*.png
```

`ScreenshotUITests.swift.template` in this folder is the capture test. It is kept
as a `.template` (not compiled) so the default CI build stays green without the
fastlane-generated `SnapshotHelper.swift`. To enable it, copy it to
`Tests/ScreenshotUITests.swift` after `fastlane snapshot init`.

## Manual fallback

Run the app in the required simulators, navigate to each screen, and capture with
`Cmd-S` (Simulator → File → Save Screen). Use a clean status bar
(`xcrun simctl status_bar <udid> override --time 9:41 --batteryState charged --batteryLevel 100`).
