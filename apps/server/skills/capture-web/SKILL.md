---
name: capture-web
description: Captura screenshots y video de una app web (Mono, Next, Vite, cualquier URL) como evidencia de una tarea. Usala cuando el diff toque UI web y haga falta mostrar antes/después o una demo corta.
targets: web, electron
outputs: screenshot, video
verified: "2026-10-22 (agent-browser 0.27.0, macOS arm64)"
needs: node, ffmpeg
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*), Bash(ffmpeg:*), Bash(ffprobe:*), Bash(mkdir:*), Bash(ls:*), Bash(sleep:*)
---

# capture-web

Evidencia visual de una app web con `agent-browser` (Chrome por CDP). Todo va a un directorio temporal y se sube a la tarea con `ws asset`.

## Contrato (igual en todas las capture-*)

1. Entrada: id de la tarea, y una lista de tomas `{label, cómo llegar}`. Salen de `ws get <tarea> ui` (nodos sin `image`) y de las notas de captura de la tarea.
2. Salida: por cada toma, `<label-slug>.png` y, si pide video, `<label-slug>.mp4` + `<label-slug>.gif`.
3. Subir con `ws asset <tarea> <archivos…>` y devolver, por toma, los nombres en `assets/`. No edites el board vos: lo hace quien te invocó.
4. No modifiques la app que estás capturando, no hagas login con credenciales reales ni publiques nada.

## Pasos

```bash
OUT=$(mktemp -d)            # todo se escribe acá
AB="npx -y agent-browser"
npx -y agent-browser install   # solo la primera vez (baja Chrome, ~190 MB)
```

Los comandos de abajo se corren sueltos (no guardes `$AB` en una variable: zsh no la expande).

**Screenshot**
```bash
npx -y agent-browser set viewport 1280 800     # 1440 900 para desktop ancho; 390 844 para mobile
npx -y agent-browser open <url>
npx -y agent-browser wait 1500
npx -y agent-browser screenshot "$OUT/<label>.png"
```

**Video** (la grabación abre la URL ella misma; las acciones van entre `start` y `stop`)
```bash
npx -y agent-browser set viewport 1280 800
npx -y agent-browser record start "$OUT/<label>.webm" <url>
npx -y agent-browser wait 1500
npx -y agent-browser snapshot -i            # lista refs @eN para interactuar
npx -y agent-browser click @e5              # pausas de ~800 ms entre acciones
npx -y agent-browser wait 1200
npx -y agent-browser record stop
npx -y agent-browser close
ffmpeg -loglevel error -y -i "$OUT/<label>.webm" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$OUT/<label>.mp4"
ffmpeg -loglevel error -y -i "$OUT/<label>.mp4" -vf "fps=8,scale=720:-1" "$OUT/<label>.gif"
```

Videos de 5 a 15 s: una acción por clip. Si hace falta un estado (login, datos), preparalo antes de `record start`.

## Notas

- `agent-browser skills get core` imprime la guía completa del CLI (refs, formularios, sesiones, Electron con `skills get electron`).
- Para Electron: `agent-browser skills get electron`.
- Si `agent-browser` falla en instalar Chrome, avisá en el resultado; no reintentes en loop.
