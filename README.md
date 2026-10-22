# Avocado Workspace

App local y personal para ver el trabajo como flujos editables, mirar a los agentes trabajar y chatear con ellos.

## Cómo corre

- **Servicio de macOS** (`com.famonfa.avocado-workspace`): `node server/main.mjs` en http://localhost:4600. Sirve la app compilada (`dist/`), la API y los eventos en vivo (SSE). Solo escucha en `127.0.0.1`.
- Logs: `~/Library/Logs/avocado-workspace.log`

## Desarrollo

```bash
npm run dev      # Vite con hot reload en http://localhost:4601 (usa la API del servicio)
npm run build    # compila el frontend; el servicio lo sirve sin reiniciar
launchctl kickstart -k gui/$(id -u)/com.famonfa.avocado-workspace   # reiniciar el backend tras cambiar server/
```

Reiniciar el backend corta los chats abiertos desde la app; se retoman al mandar el próximo mensaje.

## Partes

- `server/store.mjs` — tareas, boards y docs en `data/tasks/<TAREA>/` (no se versiona: tiene datos de clientes)
- `server/sessions.mjs` — lee los transcripts de Claude Code (`~/.claude/projects`) y los vincula a tareas
- `server/chats.mjs` — sesiones manejadas desde la app con el Agent SDK (permisos, interrupción, retomar)
- `server/refresh.mjs` — "Actualizar con IA": sesión headless que lee la actividad de los agentes y actualiza boards
- `bin/ws.mjs` — CLI `ws` que usan la IA y el skill `/workspace`
