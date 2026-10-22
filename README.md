# Mono 🐒

Mono vive en `~/mono` (`~/avocado-workspace` es un symlink para rutas viejas). App personal para ver el trabajo como flujos editables, mirar a los agentes de Claude Code trabajar y chatear con ellos, desde la Mac, la web o el celu.

## Apps

| App | Qué es |
| --- | --- |
| `apps/server` | Paquete npm `@famonfa/mono`: server local (API + eventos en vivo + Agent SDK) y el CLI `mono` / `ws`. Corre Claude Code en tu Mac. |
| `apps/web` | La interfaz (React + Vite). La sirve el server; la usan el escritorio, la web y el celu. |
| `apps/desktop` | App de macOS (Electron). Usa el server local, y si no está corriendo lo levanta. |
| `apps/relay` | Puerta pública multiusuario: login con Google, invitaciones y el túnel hacia la Mac de cada uno. |
| `apps/mobile` | App de iOS y Android (Capacitor) que abre tu relay, con login de Google desde el navegador del sistema. |

En este checkout los datos quedan en `~/mono/data/` (no se versionan; se cambian con `MONO_DATA_DIR`). Instalado con npm, van a `~/.mono/data/`.

## Escritorio: igual que `t3`

```bash
mono                     # levanta el server si hace falta y abre Mono (Mono.app → Electron de dev → navegador)
mono status              # server, servicio y conexión remota
mono service install     # arranca solo al iniciar sesión (launchd) y pone mono/ws en el PATH
npm run desktop:package  # genera apps/desktop/release/mac-arm64/Mono.app → copiala a /Applications
```

## Celu, web e invitados (como T3)

Cada persona corre Mono en **su** Mac, con su Claude Code. Un único relay en la nube les da login con Google y acceso desde el celu o la web; cada uno ve solo sus máquinas.

**Una vez (admin):**
1. El relay corre en la VM gratis de Oracle que comparte con Omno: `https://mono.155-181-39-178.sslip.io`. Para deployar, `apps/relay/deploy.sh` (ssh `pelado-oracle`): sincroniza `/srv/mono-relay`, y la primera vez crea el `.env`, el servicio `mono-relay` (con tope de 512 MB y 50% de CPU) y su entrada en Caddy. La entrada de Omno no se toca. Las credenciales van en `/srv/mono-relay/.env` y las variables están explicadas en `apps/relay/.env.example`.
2. Google Cloud Console → Credentials → *OAuth client ID* (Web application), con el redirect `https://mono.155-181-39-178.sslip.io/_mono/auth/callback`.
3. Publicar el paquete: `cd apps/server && npm publish` (publica `@famonfa/mono` con la UI ya compilada).

**Invitar:** entrás a `https://<relay>/_mono/admin`, ponés el email de Google de la persona y le mandás el link. Para quitarle el acceso, "Quitar": se corta su sesión y se desconectan sus Macs.

**App de escritorio para invitados:** `npm run desktop:publish` arma `Mono-arm64.dmg` y `Mono-x64.dmg` (la app trae el server adentro, sin el binario de Claude) y los sube al relay. Se descargan desde la landing. Adentro, el menú **Mono → Conectar con el celular…** deja el server corriendo en segundo plano y empareja la Mac. Hasta que la app esté firmada (Apple Developer), macOS pide "Abrir igual" la primera vez.

**Cada invitado, por terminal (alternativa):**
```bash
npm i -g @famonfa/mono
mono service install     # queda corriendo y se reconecta al iniciar sesión
mono connect             # usa el relay por defecto; abre el navegador, entra con Google y aprueba el código
```
Después usa `https://mono.155-181-39-178.sslip.io` desde cualquier navegador o la app móvil (`npm run mobile:ios` / `mobile:android`).

Fuera del repo, Mono guarda todo en `~/.mono/` (config, conexión y `data/`) y le instala a Claude Code el skill `/workspace` si no lo tiene. La carpeta por defecto de los chats nuevos es `defaultCwd` en `~/.mono/config.json` (si no está, el home).

## Desarrollo

```bash
npm install
npm run dev       # Vite con hot reload en http://localhost:4601 (usa la API del server en :4600)
npm run build     # compila apps/web; el server lo sirve sin reiniciar
npm run desktop   # build + Electron
launchctl kickstart -k gui/$(id -u)/com.famonfa.mono   # reiniciar el server tras cambiar apps/server
```

Para probar el relay en local, sin Google: `PORT=4700 SESSION_SECRET=$(openssl rand -hex 32) ADMIN_EMAILS=yo@x.com DEV_LOGIN=1 npm run relay`, y después `mono connect http://localhost:4700`.

## Partes del server

- `store.mjs`: tareas, boards y docs en `data/tasks/<TAREA>/`
- `sessions.mjs`: lee los transcripts de Claude Code (`~/.claude/projects`) y los vincula a tareas
- `chats.mjs`: sesiones manejadas desde la app con el Agent SDK (permisos, interrupción, retomar)
- `refresh.mjs`: "Actualizar con IA", una sesión headless que lee la actividad de los agentes y actualiza los boards
- `remote.mjs`: conexión saliente al relay; reenvía los pedidos al server local y le pasa los eventos
- `launcher.mjs`: `mono`, `connect`, `status` y `service`
