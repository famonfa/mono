---
name: capture-ios
description: Capture screenshots and video from the iOS simulator (native or React Native apps) as evidence for a task. Use it when the diff touches screens of an iOS app.
targets: ios, react-native
outputs: screenshot, video
verified: "2026-10-22 (xcrun simctl, iOS 18.4 and 26.3, macOS arm64)"
needs: xcode, ffmpeg
allowed-tools: Bash(xcrun simctl:*), Bash(ffmpeg:*), Bash(ffprobe:*), Bash(mkdir:*), Bash(sleep:*), Bash(kill -INT:*), Bash(ls:*)
---

# capture-ios

Simulator evidence with `xcrun simctl` (ships with Xcode, no extra dependencies). Same output contract as `capture-web`: files in a temp directory and `ws asset <task> <files…>`.

## Steps

```bash
xcrun simctl list devices available | grep -E "Booted|iPhone"   # pick one; if one is Booted, use "booted"
xcrun simctl boot <UDID>                                          # if none is booted
xcrun simctl bootstatus <UDID> -b                                 # waits until boot finishes
OUT=$(mktemp -d)
```

**Navigate to the screen**
- Installed app: `xcrun simctl launch booted <bundle.id>`
- Deep link / URL scheme: `xcrun simctl openurl booted "myapp://path"`
- Install a build: `xcrun simctl install booted <path/App.app>` (React Native: the `.app` that `npx react-native run-ios` / `expo run:ios` leaves in DerivedData).

Limitation: `simctl` can't tap or gesture. If the shot requires tapping elements, get there via deep link or leave the shot pending and note "needs gestures (Maestro/argent)".

**Screenshot**
```bash
xcrun simctl io booted screenshot "$OUT/<label>.png"
```

**Video**
```bash
xcrun simctl io booted recordVideo --codec=h264 -f "$OUT/<label>.mov" &
REC=$!
sleep 1
xcrun simctl launch booted <bundle.id>     # or openurl
sleep 4                                     # length of the action
kill -INT $REC; sleep 2                     # INT closes the file properly
ffmpeg -loglevel error -y -i "$OUT/<label>.mov" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$OUT/<label>.mp4"
ffmpeg -loglevel error -y -i "$OUT/<label>.mp4" -vf "fps=8,scale=360:-1" "$OUT/<label>.gif"
```

## Notes

- If the user already had a simulator open, use it and don't shut it down. If you booted it, leave it as it was when done (`xcrun simctl shutdown <UDID>`).
- The simulator is device-sized (e.g. 1206×2622); the GIF is scaled down to 360 px wide.
