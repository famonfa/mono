---
name: capture-android
description: Captura screenshots y video de un emulador o dispositivo Android (apps nativas o React Native) como evidencia de una tarea. Usala cuando el diff toque pantallas de una app Android.
targets: android, react-native
outputs: screenshot, video
verified: "2026-10-22 (adb 37.0.1, emulador android-35 arm64, con gestos durante la grabación)"
needs: android-sdk, ffmpeg
allowed-tools: Bash(adb:*), Bash(*/platform-tools/adb:*), Bash(*/emulator/emulator:*), Bash(ffmpeg:*), Bash(ffprobe:*), Bash(mkdir:*), Bash(sleep:*), Bash(ls:*)
---

# capture-android

Evidencia de Android con `adb` (screencap + screenrecord). Mismo contrato de salida que `capture-web`: archivos en un directorio temporal y `ws asset <tarea> <archivos…>`.

## Encontrar adb

`adb` suele no estar en el PATH. Usá, en este orden: `adb` si existe; `$ANDROID_HOME/platform-tools/adb`; `~/Library/Android/sdk/platform-tools/adb`. En los comandos de abajo `ADB` es esa ruta escrita literal (no uses una variable: el comando tiene que empezar con la ruta).

## Pasos

```bash
ADB devices                                    # ¿hay uno en estado "device"? usalo
~/Library/Android/sdk/emulator/emulator -list-avds
# si no hay ninguno, arrancá un AVD en segundo plano y esperá:
nohup ~/Library/Android/sdk/emulator/emulator -avd <AVD> -no-window -no-audio -no-boot-anim -no-snapshot-save >/dev/null 2>&1 &
ADB wait-for-device
# repetí hasta que dé 1 (cada 3 s, máx. 40 veces):
ADB shell getprop sys.boot_completed
OUT=$(mktemp -d)
```

No lances varios `adb` a la vez mientras el daemon arranca (falla con "cannot connect to daemon"): esperá el primero.

**Navegar**
- Abrir app: `ADB shell monkey -p <paquete> -c android.intent.category.LAUNCHER 1`
- Deep link: `ADB shell am start -a android.intent.action.VIEW -d "miapp://ruta"`
- Gestos: `ADB shell input tap X Y`, `input swipe X1 Y1 X2 Y2 300`, `input text "hola"`, `input keyevent KEYCODE_BACK`
- React Native en dev: el bundler (Metro) tiene que estar corriendo y `ADB reverse tcp:8081 tcp:8081`.

**Screenshot**
```bash
ADB exec-out screencap -p > "$OUT/<label>.png"
```

**Video** (screenrecord solo codifica cuando la pantalla cambia; con la pantalla quieta el clip dura menos de lo pedido)
```bash
ADB shell "screenrecord --time-limit 10 /sdcard/cap.mp4" &     # máximo 180 s
sleep 1
ADB shell input tap X Y                                         # las acciones del clip
sleep 2
wait                                                            # espera que termine el límite
ADB pull /sdcard/cap.mp4 "$OUT/<label>.mp4"
ADB shell rm /sdcard/cap.mp4
ffmpeg -loglevel error -y -i "$OUT/<label>.mp4" -vf "fps=8,scale=480:-1" "$OUT/<label>.gif"
```

## Notas

- Si arrancaste el emulador vos, apagalo al terminar: `ADB emu kill`. Si ya estaba corriendo, no lo toques.
- No hace falta Java para `adb` ni para el emulador (sí para `sdkmanager`/`avdmanager`).
