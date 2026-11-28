# Skills directory — layout reference

Each skill is a **subdirectory** whose name is the skill id (must match `^[a-z][a-z0-9_-]*$`).
Inside it, `SKILL.md` is the required entry point; extra files sit next to it and are reachable
via the `read` tool when the skill is injected into a sub-agent's system prompt.

```
skills/
├── README.md               ← this file (NOT a skill; the CLI and the Worker zip validator skip it)
└── forge-ui/
    └── SKILL.md            ← example skill (id: forge-ui)
```

A skill is injected when a pipeline step's agent declares it in `skills: ["<id>"]`
(see `agents/README.md` / the `skills` field). Skills with no matching agent declaration are
simply never loaded — declaring one that doesn't exist is ignored with a runtime warning.

Push with `node agent/orchestration/push.mjs --skills-only` (or full `node agent/orchestration/push.mjs`).
