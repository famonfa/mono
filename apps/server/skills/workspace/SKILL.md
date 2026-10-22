---
name: workspace
description: Document a task visually in Mono (http://localhost:4600) — TL;DR, story map, before/after flow, test flows and technical map as editable canvases, plus short docs. Use when the user runs /workspace [TICKET], asks to "document this in my workspace", "documentalo en mi workspace", "armame el canvas / story map / flujos", or wants a visual summary of work done. Never commit or publish its output.
---

# Workspace

Turn a task into a visual, editable workspace entry. The user reviews work by **looking at flows**, not by reading the conversation. Optimize for: understood in 30 seconds, then explore by clicking.

Mono runs locally on this machine. Data: `ws path <TASK>` prints the task folder. The UI refreshes live when you write.

CLI: `mono` or its alias `ws` (on PATH) — run `ws` with no args for usage. Don't store it in a shell variable: zsh won't word-split `$WS`.

## Arguments

`/workspace [TICKET | slug] [board...]`

- No argument: infer the ticket from the current worktree path (`.worktrees/<TICKET>/`) or branch name.
- Extra args limit which boards to (re)generate, e.g. `/workspace ABC-123 testeo`.

## 1. Make sure the app is running

```bash
curl -s -o /dev/null localhost:4600/api/health || mono serve > /tmp/mono.log 2>&1 &
```

## 2. Gather facts (cheaply)

Read only what you need; never paste big outputs into context.

- **Existing entry:** `ws show <TASK>` — if it exists you are *updating*: keep node ids stable so the user's layout survives.
- **Conversation:** the work you just did is the best source. Use it.
- **Other agents:** `ws sessions <TASK>` prints what every linked Claude Code session and subagent did recently (sessions link by PR, branch, worktree or a mention of the task id). Use it as evidence for test results and new findings — e.g. QA agents running in another session.
- **Ticket:** if the project has a tracker CLI or API documented in its CLAUDE.md (Linear, Jira, GitHub issues), fetch only title, url, state and the first ~2000 chars of the description.
- **Code:** per repo worktree in `.worktrees/<TASK>/<repo>`: `git log --oneline origin/<base>..HEAD` and `git diff --stat origin/<base>...HEAD | tail -30`. Read specific diffs only to understand behavior.
- **PRs:** `gh pr view --json number,url,title,state` inside each worktree.
- **UI changes?** Check the diff for UI files (`.tsx`, `.css`, `.css.ts`, screens/components). If there are none, do not create the `ui` board. If there are and no screenshots exist yet, screenshot the running app (Playwright or the project's own capture tooling), then build the `ui` board from them.
- **Screenshots:** if QA or capture tools produced images (simulator screenshots, Playwright captures), copy them in with `ws asset <TASK> <files...>` and reference them as `assets/<name>.png`.

## 3. Write the entry

Write JSON/MD to `/tmp/ws-<TASK>/` and load each with the CLI. Write everything in the user's language.

### task.json → `ws task <TASK> /tmp/ws-<TASK>/task.json`

```json
{
  "title": "Refund + cancel en órdenes pagas",
  "status": "en-curso",
  "risk": "medio",
  "tldr": { "problema": "…", "solucion": "…", "impacto": "…" },
  "summary": "markdown corto: origen, estado, pendientes fuera de scope",
  "repos": [{ "name": "api", "branch": "ABC-123-refunds", "pr": "https://github.com/…/pull/1637" }],
  "linear": "https://linear.app/…/issue/ABC-123",
  "tags": ["refunds"],
  "relatedPrs": [1476, 1479]
}
```

`status`: `planificado | en-curso | en-review | hecho | bloqueado`. `relatedPrs`: superseded or companion PR numbers, so agent sessions that worked on them link to this task. `projects`: optional list of project ids (the directories Mono shows: `curl -s localhost:4600/api/projects | jq -r '.[].id'`); if omitted, repos are matched to projects by name. `risk`: `bajo | medio | alto`. Each TL;DR field ≤ 2 sentences.

### Boards → `ws board <TASK> <board-id> /tmp/ws-<TASK>/<board>.json`

Default set (skip a board when it adds nothing, e.g. no tech map for a one-file fix):

| board-id | kind | layout | What it shows |
| --- | --- | --- | --- |
| `story-map` | storymap | storymap | Actors → activities (columns, in order) → steps under each activity. Mark what changed. |
| `flujo` | flow | lanes | Lanes `Antes` / `Después` with the same steps side by side, or one lane per variant. |
| `testeo` | tests | lanes | One lane per test path; last node carries the result (`test`) and screenshot (`image`). |
| `mapa-tecnico` | tech | lanes | One lane per repo; nodes = modules/files touched; edges = data flow between them. |
| `ui` | ui | lanes | **Only if the change touched UI.** One lane per screen/state; `image` nodes with real screenshots (`status` new/changed). Skip entirely for backend-only work. |

Board file shape (flat nodes — the CLI normalizes them):

```json
{
  "title": "Flujos de testeo", "kind": "tests", "layout": "lanes", "direction": "LR", "order": 3,
  "description": "Una línea que explica cómo leer el board.",
  "nodes": [
    { "id": "t1a", "lane": "1 · Reembolso parcial", "label": "Orden paga con loyalty" },
    { "id": "t1b", "lane": "1 · Reembolso parcial", "label": "Puntos revocados", "test": "pass", "image": "assets/refund-partial.png" }
  ],
  "edges": [{ "from": "t1a", "to": "t1b", "label": "opcional", "dashed": false, "animated": false }]
}
```

Never create `lane`-type nodes or set `parentId`/`position` — the app owns layout; put the lane name in each node's `lane`. If a write goes wrong, `ws undo <task> <board>` restores the previous version.

Node fields: `id` (stable, short), `type` (`card` default | `actor` | `activity` | `note` | `image`), `label`, `detail`, `status` (`new | changed | same | removed | risk`), `test` (`pass | fail | todo | skip`), `repo`, `files` (array), `image` (`assets/…`), `lane` (lanes layout), `activity` (storymap: id of the activity column), `color` (hex, notes), `link`.

Storymap specifics: `actor` nodes go in a left column; `activity` nodes become columns in array order (prefix labels with `1.`, `2.`…); steps reference their column with `activity`. Use a `note` (color `#fee2e2`) for pending items or risks outside scope.

### Docs → `ws doc <TASK> <name>.md /tmp/ws-<TASK>/<name>.md`

Only when they add value; usually just `decisiones.md` (table: decisión | por qué, plus rollout risks). No essays.

## Content rules

- **Labels ≤ 6 words.** `detail` ≤ 2 short lines. If it needs more, it belongs in a doc.
- **Every step gets a `status`** in story map, flow and tech map, so colors tell the story: green new, orange changed, gray unchanged, purple risk/bug (use `risk` for the "before" problems).
- **Test results must be real.** `pass`/`fail` only for paths that were actually exercised (tests run, manual QA, simulator); everything else is `todo`. Never invent results.
- **Facts only from evidence** (diff, ticket, PR, conversation). If unsure, put it in a `note` as a question.
- **Updating:** reuse the same ids. The CLI keeps positions the user arranged, keeps nodes the user edited (`edited`) or created (`manual`), and places new nodes next to their predecessor. Use `--relayout` only if the user asks to reorganize everything.

## 4. Finish

Run `ws open <TASK>` and reply with **one or two lines**: what boards were created/updated and anything that needs the user's attention (failed tests, open questions). Don't repeat the content in chat — it lives in the workspace.
