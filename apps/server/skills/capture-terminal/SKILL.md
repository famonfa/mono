---
name: capture-terminal
description: Graba una sesión de terminal (CLI/TUI) como GIF o video con VHS. Usala cuando el cambio sea de una herramienta de línea de comandos y no tenga pantalla que capturar.
targets: cli, tui
outputs: video, screenshot
verified: false
needs: vhs, ttyd, ffmpeg
allowed-tools: Bash(vhs:*), Bash(ffmpeg:*), Bash(mkdir:*), Bash(ls:*)
---

# capture-terminal

SIN VERIFICAR: `brew install vhs` no se pudo probar en la máquina de desarrollo (Homebrew bloqueó taps no confiables). Si `vhs` no está instalado, no lo instales por tu cuenta: dejá la toma como pendiente e indicá "falta vhs (brew install vhs)".

Mismo contrato de salida que `capture-web`: archivos en un directorio temporal y `ws asset <tarea> <archivos…>`.

## Pasos

Escribí un `.tape` en el directorio temporal y corrélo:

```tape
Output demo.gif
Set Shell "zsh"
Set FontSize 16
Set Width 1000
Set Height 560
Set TypingSpeed 60ms
Type "mi-cli --help"
Enter
Sleep 2s
Screenshot shot.png
```

```bash
vhs demo.tape
```

Reglas útiles: `Output` primero, `Require <cmd>` para validar dependencias, `Hide`/`Show` para ocultar preparación, `Sleep` natural entre comandos. Referencia completa en la skill `vhs` (pproenca/dot-skills) si está disponible.
