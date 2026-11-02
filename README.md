# dsh-coding-discipline

An always-on coding-discipline layer for DeepSeek Harness. It does not add tools or
call the model twice — it changes what the model is told to treat as acceptable
work, on every step, and ships a longer protocol the model can load when a task
deserves it.

## What it targets

Each rule names one failure mode that costs real time in long coding sessions:

| Rule | Failure it prevents |
|---|---|
| `ledger` | Constraints stated early ("don't touch the public API") get dropped 40 turns later |
| `proof` | "已完成 / 应该没问题" without a build or test run in that turn |
| `smallest-diff` | A 3-line change rewritten as a whole-file replacement, with unrelated churn |
| `hypothesis` | Guess-and-patch loops on linker/ABI/runtime bugs instead of a discriminating experiment |
| `no-invented-apis` | Plausible-looking flags, signatures and config keys that do not exist |
| `finish-migration` | Refactors that leave one call site on the old path |
| `evidence-over-agreeing` | Editing working code because the user said "this looks wrong" |
| `no-speculative-code` | Abstractions, parameters and defensive branches nobody asked for |
| `closing-shape` | Reports that celebrate instead of stating what changed, what ran, what is unverified |

## Install

Three ways, all require restarting DSH afterwards.

### A. From npm (published package)

```bash
dsh plugin --profile desktop add dsh-coding-discipline
```

or from inside DSH: **Settings → Plugins → Plugin Market**, search
`dsh-coding-discipline`, install, restart.

### B. As a bundle in the profile (local development)

1. Put this directory anywhere stable (it is linked, not copied):

   ```
   C:\Users\<you>\Documents\deepseek-harness\default-workspace\dsh-coding-discipline
   ```

2. Add the dependency to `~/.dsh/profiles/desktop/package.json`:

   ```json
   "dsh-coding-discipline": "link:C:/Users/<you>/Documents/deepseek-harness/default-workspace/dsh-coding-discipline"
   ```

3. Add it to the composition, same file, under `dsh.profile.bundles`:

   ```json
   "dsh-coding-discipline"
   ```

4. Install the link:

   ```bash
   cd ~/.dsh/profiles/desktop && npx pnpm@11 install
   ```

### C. Via the local plugin manager

Point the plugin manager at this directory as a local bundle; it writes the same
two entries for you.

## Verify it loaded

After restart, the section is part of every request. Either:

- ask the model to restate its `<coding_discipline>` rules — it should quote them;
- or run the package's own tests: `node --test` (22 tests, no DSH needed).

If the app fails to start after install, remove the single `"dsh-coding-discipline"`
line from `dsh.profile.bundles` and restart — nothing else is touched.

## The effect dashboard

Two ways to see whether the rules change anything, both reading the same
analysis over persisted session logs (`~/.dsh/sessions/**/session.v4.jsonl.zstd`):

```bash
# 1. a static page you can open from disk
node scripts/dashboard.mjs        # -> ~/.dsh/plugin-data/dsh-coding-discipline/dashboard.html

# 2. the hosted route (needs the plugin loaded, i.e. after a restart)
open http://127.0.0.1:<dsh-port>/coding-discipline
```

What it measures:

| Metric | How it is computed |
|---|---|
| 改动-验证闭环率 | turns containing an edit/write tool call **and** a verification command in the same turn, over all editing turns |
| 无证据的完成声明 | turns whose closing message claims completion while no verification command ran that turn |
| 代价 | tool calls per turn, answer characters per turn |

Grouping is by **turn**, decided by whether that turn's system prompt contains
`<coding_discipline>` — not by date, so a session that started before the install
contributes its later turns to the treatment arm.

There is no randomisation and the baseline is your own history. The page says so
in a banner and again in the method note; it answers "did the behaviour change",
not "is the model better".

## Configuration

In `~/.dsh/profiles/desktop/cordis.patch.yml`:

```yaml
- id: coding-discipline
  config:
    enabled: true        # false = unregister every contribution
    order: 9500          # prompt order; runtime context sits at 10000+
    promptSection: true  # false = keep the skill only
    skill: true          # false = keep the prompt section only
    compact: false       # true = keep only proof / ledger / smallest-diff / hypothesis
    extraRules: ''       # deployment lines, appended in order
    dropRules: []        # rule ids to omit, e.g. ['closing-shape']
    dashboard: true      # false = do not serve /coding-discipline
    sessionsRoot: ''     # '' = ~/.dsh/sessions; a path measures one workspace
```

Token cost: the full section is about 750 tokens per request; `compact: true`
cuts it to roughly 470.

## Layout

```
src/prompt.js    section text, settings normalization (pure, unit-tested)
src/skill.js     bundled coding-discipline skill from SKILL.md
src/index.js     cordis wiring: section + optional skill provider + route
src/sessions.js  zstd-framed session log reader
src/analyze.js   turn-level metrics, arm detection, daily series
src/report.js    self-contained HTML for the dashboard
src/route.js     page cache + HTTP handler for /coding-discipline
scripts/dashboard.mjs  CLI: analyse every session, write the page
SKILL.md         the long-form protocol (checklists, recipes, debugging ladder)
test/            22 node:test cases, including a fake-context registration test
```

## Limits

- It is prompt influence, not enforcement: a model can still ignore a rule. The
  rules are phrased as triggers ("before the first edit", "two speculative edits
  in a row") because trigger-shaped instructions survive long sessions better
  than general virtues.
- It applies to every agent in the composition, including subagents.
- It does not verify your build for you; it makes an unverified claim explicit.
