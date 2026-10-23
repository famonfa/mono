---
name: capture-web
description: Capture screenshots and video of a web app (Mono, Next, Vite, any URL) as evidence for a task. Use it when the diff touches web UI and you need to show before/after or a short demo.
targets: web, electron
outputs: screenshot, video
verified: "2026-10-22 (agent-browser 0.27.0, macOS arm64)"
needs: node, ffmpeg
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*), Bash(ffmpeg:*), Bash(ffprobe:*), Bash(mkdir:*), Bash(ls:*), Bash(sleep:*)
---

# capture-web

Visual evidence of a web app with `agent-browser` (Chrome over CDP). Everything goes to a temp directory and is uploaded to the task with `ws asset`.

## Contract (same for every capture-*)

1. Input: the task id and a list of shots `{label, how to get there}`. They come from `ws get <task> ui` (nodes without `image`) and the task's capture notes.
2. Output: for each shot, `<label-slug>.png` and, if video is requested, `<label-slug>.mp4` + `<label-slug>.gif`.
3. Upload with `ws asset <task> <files…>` and return, per shot, the names under `assets/`. Don't edit the board yourself: whoever invoked you does that.
4. Don't modify the app you're capturing, don't log in with real credentials, and don't publish anything.

## Steps

```bash
OUT=$(mktemp -d)            # everything is written here
AB="npx -y agent-browser"
npx -y agent-browser install   # first time only (downloads Chrome, ~190 MB)
```

Run the commands below as-is (don't store `$AB` in a variable: zsh won't expand it).

**Screenshot**
```bash
npx -y agent-browser set viewport 1280 800     # 1440 900 for wide desktop; 390 844 for mobile
npx -y agent-browser open <url>
npx -y agent-browser wait 1500
npx -y agent-browser screenshot "$OUT/<label>.png"
```

**Video** (recording opens the URL itself; actions go between `start` and `stop`)
```bash
npx -y agent-browser set viewport 1280 800
npx -y agent-browser record start "$OUT/<label>.webm" <url>
npx -y agent-browser wait 1500
npx -y agent-browser snapshot -i            # lists @eN refs to interact with
npx -y agent-browser click @e5              # ~800 ms pauses between actions
npx -y agent-browser wait 1200
npx -y agent-browser record stop
npx -y agent-browser close
ffmpeg -loglevel error -y -i "$OUT/<label>.webm" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$OUT/<label>.mp4"
ffmpeg -loglevel error -y -i "$OUT/<label>.mp4" -vf "fps=8,scale=720:-1" "$OUT/<label>.gif"
```

5 to 15 s videos: one action per clip. If a state is needed (login, data), set it up before `record start`.

## Notes

- `agent-browser skills get core` prints the full CLI guide (refs, forms, sessions, Electron with `skills get electron`).
- For Electron: `agent-browser skills get electron`.
- If `agent-browser` fails to install Chrome, say so in the result; don't retry in a loop.
