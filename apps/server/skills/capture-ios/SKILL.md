---
name: capture-ios
description: Captura screenshots y video del simulador de iOS (apps nativas o React Native) como evidencia de una tarea. Usala cuando el diff toque pantallas de una app iOS.
targets: ios, react-native
outputs: screenshot, video
verified: "2026-10-22 (xcrun simctl, iOS 18.4 y 26.3, macOS arm64)"
needs: xcode, ffmpeg
allowed-tools: Bash(xcrun simctl:*), Bash(ffmpeg:*), Bash(ffprobe:*), Bash(mkdir:*), Bash(sleep:*), Bash(kill -INT:*), Bash(ls:*)
---

# capture-ios

Evidencia del simulador con `xcrun simctl` (viene con Xcode, sin dependencias extra). Mismo contrato de salida que `capture-web`: archivos en un directorio temporal y `ws asset <tarea> <archivos…>`.

## Pasos

```bash
xcrun simctl list devices available | grep -E "Booted|iPhone"   # elegí uno; si hay Booted, usá "booted"
xcrun simctl boot <UDID>                                          # si no hay ninguno booted
xcrun simctl bootstatus <UDID> -b                                 # espera a que termine de arrancar
OUT=$(mktemp -d)
```

**Navegar a la pantalla**
- App instalada: `xcrun simctl launch booted <bundle.id>`
- Deep link / URL scheme: `xcrun simctl openurl booted "miapp://ruta"`
- Instalar un build: `xcrun simctl install booted <ruta/App.app>` (en React Native: el `.app` que deja `npx react-native run-ios` / `expo run:ios` en DerivedData).

Limitación: `simctl` no hace taps ni gestos. Si la toma exige tocar elementos, llegá por deep link o dejá la toma como pendiente e indicá "requiere gestos (Maestro/argent)".

**Screenshot**
```bash
xcrun simctl io booted screenshot "$OUT/<label>.png"
```

**Video**
```bash
xcrun simctl io booted recordVideo --codec=h264 -f "$OUT/<label>.mov" &
REC=$!
sleep 1
xcrun simctl launch booted <bundle.id>     # o openurl
sleep 4                                     # duración de la acción
kill -INT $REC; sleep 2                     # INT cierra el archivo correctamente
ffmpeg -loglevel error -y -i "$OUT/<label>.mov" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$OUT/<label>.mp4"
ffmpeg -loglevel error -y -i "$OUT/<label>.mp4" -vf "fps=8,scale=360:-1" "$OUT/<label>.gif"
```

## Notas

- Si el usuario ya tenía un simulador abierto, usalo y no lo apagues. Si lo arrancaste vos, dejalo como estaba al terminar (`xcrun simctl shutdown <UDID>`).
- El simulador tiene el tamaño del dispositivo (p. ej. 1206×2622); el GIF se reduce a 360 px de ancho.
