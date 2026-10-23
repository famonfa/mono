---
name: capture-android
description: Capture screenshots and video from an Android emulator or device (native or React Native apps) as evidence for a task. Use it when the diff touches screens of an Android app.
targets: android, react-native
outputs: screenshot, video
verified: "2026-10-22 (adb 37.0.1, android-35 arm64 emulator, with gestures during recording)"
needs: android-sdk, ffmpeg
allowed-tools: Bash(adb:*), Bash(*/platform-tools/adb:*), Bash(*/emulator/emulator:*), Bash(ffmpeg:*), Bash(ffprobe:*), Bash(mkdir:*), Bash(sleep:*), Bash(ls:*)
---

# capture-android

Android evidence with `adb` (screencap + screenrecord). Same output contract as `capture-web`: files in a temp directory and `ws asset <task> <files…>`.

## Finding adb

`adb` is usually not on PATH. Use, in this order: `adb` if it exists; `$ANDROID_HOME/platform-tools/adb`; `~/Library/Android/sdk/platform-tools/adb`. In the commands below `ADB` is that path written literally (don't use a variable: the command has to start with the path).

## Steps

```bash
ADB devices                                    # one in "device" state? use it
~/Library/Android/sdk/emulator/emulator -list-avds
# if there are none, start an AVD in the background and wait:
nohup ~/Library/Android/sdk/emulator/emulator -avd <AVD> -no-window -no-audio -no-boot-anim -no-snapshot-save >/dev/null 2>&1 &
ADB wait-for-device
# repeat until it returns 1 (every 3 s, max 40 times):
ADB shell getprop sys.boot_completed
OUT=$(mktemp -d)
```

Don't run several `adb` commands at once while the daemon starts (fails with "cannot connect to daemon"): wait for the first one.

**Navigate**
- Open app: `ADB shell monkey -p <package> -c android.intent.category.LAUNCHER 1`
- Deep link: `ADB shell am start -a android.intent.action.VIEW -d "myapp://path"`
- Gestures: `ADB shell input tap X Y`, `input swipe X1 Y1 X2 Y2 300`, `input text "hello"`, `input keyevent KEYCODE_BACK`
- React Native in dev: the bundler (Metro) must be running, plus `ADB reverse tcp:8081 tcp:8081`.

**Screenshot**
```bash
ADB exec-out screencap -p > "$OUT/<label>.png"
```

**Video** (screenrecord only encodes when the screen changes; on a still screen the clip is shorter than requested)
```bash
ADB shell "screenrecord --time-limit 10 /sdcard/cap.mp4" &     # max 180 s
sleep 1
ADB shell input tap X Y                                         # the clip's actions
sleep 2
wait                                                            # waits for the time limit
ADB pull /sdcard/cap.mp4 "$OUT/<label>.mp4"
ADB shell rm /sdcard/cap.mp4
ffmpeg -loglevel error -y -i "$OUT/<label>.mp4" -vf "fps=8,scale=480:-1" "$OUT/<label>.gif"
```

## Notes

- If you started the emulator, shut it down when done: `ADB emu kill`. If it was already running, leave it alone.
- `adb` and the emulator don't need Java (`sdkmanager`/`avdmanager` do).
