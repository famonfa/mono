# Mono 🐒

Mono vive en `~/mono` (`~/avocado-workspace` es un symlink para rutas viejas). App personal para ver el trabajo como flujos editables, mirar a los agentes de Claude Code trabajar y chatear con ellos, desde la Mac, la web o el celu.

## Apps

| App | Qué es |
| --- | --- |
| `apps/server` | Server local (API + eventos en vivo + Agent SDK) y el CLI `mono` / `ws`. Corre Claude Code en tu Mac. |
| `apps/web` | La interfaz (React + Vite). La sirve el server; la usan el escritorio, la web y el celu. |
| `apps/desktop` | App de macOS (Electron). Usa el server local, y si no está corriendo lo levanta. |
| `apps/relay` | Puerta pública con login de Google. Las Macs se conectan hacia afuera y el celu o la web entran por acá. |
| `apps/mobile` | App de iOS y Android (Capacitor) que abre tu relay, con login de Google desde el navegador del sistema. |

Los datos quedan en `~/mono/data/` (no se versiona; cambialo con `MONO_DATA_DIR`). La conexión remota se guarda en `~/.mono/`.

## Escritorio: igual que `t3`

```bash
mono                     # levanta el server si hace falta y abre Mono (Mono.app → Electron de dev → navegador)
mono status              # server, servicio y conexión remota
mono service install     # arranca solo al iniciar sesión (launchd) y pone mono/ws en el PATH
npm run desktop:package  # genera apps/desktop/release/mac-arm64/Mono.app → copiala a /Applications
```

## Celu y web: con Google

1. **Deploy del relay** (una sola vez). Ver `apps/relay/.env.example`. Con Fly: `cd apps/relay && fly launch --no-deploy --copy-config`, cargás los secrets y `fly deploy`. También sirve cualquier hosting que soporte WebSockets: Railway, Render o Cloud Run con `--max-instances=1`.
2. **Google OAuth**: en Google Cloud Console creás un *OAuth client ID* de tipo Web application con el redirect `https://<relay>/_mono/auth/callback`.
3. **Conectar la Mac**: corrés `mono connect https://<relay>`, se abre el navegador, entrás con Google y aprobás el código. Queda conectada y se reconecta sola.
4. **Usarlo**: entrás a `https://<relay>` desde cualquier navegador (en iPhone se puede agregar a la pantalla de inicio) o desde la app móvil.

La app móvil se abre con `npm run mobile:ios` o `npm run mobile:android` (en Xcode o Android Studio), pegás la URL del relay y entrás con Google.

Seguridad: solo entran los emails de `ALLOWED_EMAILS`, y cada Mac queda atada al email que la aprobó. Si sacás un email de la lista se cortan sus sesiones y sus Macs. Si rotás `SESSION_SECRET`, se desconecta todo.

## Desarrollo

```bash
npm install
npm run dev       # Vite con hot reload en http://localhost:4601 (usa la API del server en :4600)
npm run build     # compila apps/web; el server lo sirve sin reiniciar
npm run desktop   # build + Electron
launchctl kickstart -k gui/$(id -u)/com.famonfa.mono   # reiniciar el server tras cambiar apps/server
```

Para probar el relay en local, sin Google: `PORT=4700 SESSION_SECRET=$(openssl rand -hex 32) ALLOWED_EMAILS=yo@x.com DEV_LOGIN_EMAIL=yo@x.com npm run relay`, y después `mono connect http://localhost:4700`.

## Partes del server

- `store.mjs`: tareas, boards y docs en `data/tasks/<TAREA>/`
- `sessions.mjs`: lee los transcripts de Claude Code (`~/.claude/projects`) y los vincula a tareas
- `chats.mjs`: sesiones manejadas desde la app con el Agent SDK (permisos, interrupción, retomar)
- `refresh.mjs`: "Actualizar con IA", una sesión headless que lee la actividad de los agentes y actualiza los boards
- `remote.mjs`: conexión saliente al relay; reenvía los pedidos al server local y le pasa los eventos
- `launcher.mjs`: `mono`, `connect`, `status` y `service`
