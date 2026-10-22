# Avocado Workspace

App local y personal para ver el trabajo como flujos editables. No se commitea ni se publica.

```bash
npm start            # http://localhost:4600
node bin/ws.mjs      # CLI (la usa la IA vía el skill /workspace)
```

- Datos: `data/tasks/<TAREA>/` → `task.json`, `boards/*.json`, `docs/*.md`, `assets/*`
- Skill: `~/.claude/skills/workspace/SKILL.md` → `/workspace IME-XXXX` en Claude Code
- Lo que movés o editás a mano en un board se respeta cuando la IA lo actualiza.
