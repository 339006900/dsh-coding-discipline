---
name: coding-discipline
description: Load for multi-file edits, refactors, hard bugs, or any change that must be verified by a build or test — the full protocol for constraint tracking, evidence-based completion, hypothesis-first debugging, and migration completeness.
---

# Coding discipline

The always-on rules are in the system prompt. This skill is the long form: the
checklists, the verification recipes, and the debugging ladder. Load it when the
task spans more than one file, is a refactor, is a bug you have not localized,
or ends in a claim that the change works.

## 0. The completion contract

Never end a coding turn until you can fill all four lines:

```
changed:  <path>:<line-range> — <one clause>
verified: <command> -> <result: pass/fail/exit code>
unverified: <what could not be checked, and why>
deferred: <what is left, or "nothing">
```

If `verified:` is empty, the turn is not a completion — it is a report of work in
progress. Say so.

## 1. Pre-flight (before the first edit)

Write down, in the reply, at most four lines:

1. **Invariants** — files, public APIs, wire formats, dependencies, or behaviors
   that must not change. Take these from the user's words, not from convenience.
2. **Definition of done** — the exact command that will show the change works
   (`cmake --build build`, `dotnet build`, `pytest -q`, `npm test`, a manual
   reproduction).
3. **Blast radius** — every call site, test, doc, or config that mentions the
   symbol you are about to change. Search before editing, not after.
4. **Unknowns** — anything you are about to assume. Mark it; do not silently
   resolve it in code.

Re-read lines 1 and 4 before every edit batch and before finishing.

## 2. Verification recipes

Run the project's own command when one exists (README, CI config, Makefile,
`.vscode/tasks.json`). Otherwise:

| Stack | Build / check | Notes |
|---|---|---|
| C++ / CMake | `cmake -S . -B build && cmake --build build -j` | Reconfigure after CMakeLists changes; read the first error, not the last |
| C++ / MSVC | `msbuild <sln> /p:Configuration=Debug /m` | Check the platform is `x64`, not `Win32`, before trusting a pass |
| C# / .NET | `dotnet build <sln> -warnaserror` then `dotnet test` | A build pass with new warnings is not a clean pass |
| Python | `ruff check .` and `pytest -q` | Use the project's venv; a global interpreter can hide a missing dep |
| Node / TS | `npm test` and `npx tsc --noEmit` | `tsc` catches what tests do not import |
| Any | the failing reproduction, run twice | A fix that only compiles has not been verified |

If the toolchain is absent, say which command you would have run and what it
would have proven. "Cannot verify here" is an acceptable answer; "done" is not.

## 3. Debugging ladder

Climb one rung at a time; do not skip to editing.

1. **Reproduce** — the smallest input that fails, deterministically.
2. **Localize** — which layer? (parse / build / link / runtime / data). Wrong-layer
   hypotheses waste the whole ladder.
3. **State one cause + one discriminating observation** — a log line, a print of
   the actual value, a compiler command dump (`-###`, `/showIncludes`), a symbol
   comparison (`dumpbin /symbols`, `nm`), a minimal 20-line reproduction.
4. **Predict, then run** — write the expected output before the run. A result you
   did not predict is not evidence.
5. **Fix the cause**, re-run rung 1, and only then look at the diff.

Two failed speculative edits in a row means you are guessing: go back to rung 3
with a sharper observation.

## 4. Refactor procedure

1. Search the old name/symbol across the repo (code, tests, docs, configs,
   build files). Record the count.
2. Migrate in dependency order; keep the tree compiling after each batch when the
   language allows it.
3. Delete the old path in the same change. Leaving one unused export is a defect.
4. Grep for the old name once more and paste the (empty) result into the report.

## 5. Self-review before you finish

Read your own diff as an unfriendly reviewer:

- [ ] Every changed line is required by the request.
- [ ] No unrelated formatting, renames, or import churn.
- [ ] Error paths and types are handled the way the surrounding code does it.
- [ ] No new dependency for something the standard library already does.
- [ ] No dead code, unused parameter, or comment that restates the code.
- [ ] Tests exist for the new behavior, or the report says why not.
- [ ] The claim in the closing message matches what you actually ran.

## 6. Report template

```
changed:  src/foo.cpp:41-58 — thread the timeout through the retry loop
verified: cmake --build build -j -> exit 0; ctest -R retry -> 3/3 passed
unverified: Windows path not exercised here (no MSVC toolchain in this env)
deferred: the 2019 QSettings migration in legacy/ — out of scope
```

No celebration, no apology, no line-by-line diff recap.

## 7. Anti-patterns that look like progress

- Rewriting a file to make a 3-line change fit.
- Adding a guard for a state the type system already excludes.
- Running `clean` + full rebuild as the response to any error.
- Widening an API because a caller was inconvenient.
- Saying "should work" after a compile that produced no test run.
- Agreeing with a bug report before reproducing it.
