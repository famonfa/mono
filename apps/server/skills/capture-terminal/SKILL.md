---
name: capture-terminal
description: Record a terminal session (CLI/TUI) as a GIF or video with VHS. Use it when the change is to a command-line tool with no screen to capture.
targets: cli, tui
outputs: video, screenshot
verified: false
needs: vhs, ttyd, ffmpeg
allowed-tools: Bash(vhs:*), Bash(ffmpeg:*), Bash(mkdir:*), Bash(ls:*)
---

# capture-terminal

UNVERIFIED: `brew install vhs` couldn't be tested on the dev machine (Homebrew blocked untrusted taps). If `vhs` isn't installed, don't install it yourself: leave the shot pending and note "missing vhs (brew install vhs)".

Same output contract as `capture-web`: files in a temp directory and `ws asset <task> <files…>`.

## Steps

Write a `.tape` in the temp directory and run it:

```tape
Output demo.gif
Set Shell "zsh"
Set FontSize 16
Set Width 1000
Set Height 560
Set TypingSpeed 60ms
Type "my-cli --help"
Enter
Sleep 2s
Screenshot shot.png
```

```bash
vhs demo.tape
```

Useful rules: `Output` first, `Require <cmd>` to check dependencies, `Hide`/`Show` to hide setup, natural `Sleep` between commands. Full reference in the `vhs` skill (pproenca/dot-skills) if available.
