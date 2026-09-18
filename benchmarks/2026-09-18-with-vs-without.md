# Benchmark: wee vs hand-written, 2026-09-18

Three tasks, two arms each. Each arm is a fresh `create-next-app` copy under
`/tmp/wee-bench/<slug>/{with,without}` with a git baseline. The `with` arm
had `next-wee` linked and the AGENTS.md skill. The `without` arm had no CLI.
One subagent per arm, all six started at once, so wall time includes
contention and is relative only. Tokens come from the subagent transcripts.
`billed` = input + cache_create + output. `context` = every token the model
read across all calls.

| Task | Arm | API calls | Tool uses | Output tok | Billed tok | Context tok | Wall | Diff | tsc | test | build |
|---|---|---|---|---|---|---|---|---|---|---|---|
| model Post | with | 44 | 22 | 15,871 | 99,256 | 1.63M | 172s | 18 files +459/-3 | pass | pass | n/a |
| model Post | without | 94 | 49 | 53,722 | 169,213 | 4.68M | 385s | 11 files +232/-1 | pass | pass | n/a |
| job SendWelcome | with | 57 | 30 | 23,742 | 145,861 | 2.61M | 247s | 10 files +236/-2 | pass | pass | n/a |
| job SendWelcome | without | 37 | 19 | 22,626 | 93,642 | 1.47M | 192s | 6 files +79/-1 | pass | pass | n/a |
| resource Post | with | 82 | 46 | 39,371 | 166,761 | 3.72M | 348s | 43 files +1174/-4 | pass | pass | pass* |
| resource Post | without | 154 | 84 | 93,457 | 303,653 | 10.46M | 759s | 20 files +487/-9 | pass | pass | pass |

`*` Agent-reported. I ran `wee destroy resource Post` before my own rebuild,
so my rebuild failed on the hand-edited `layout.tsx` importing the removed
`@/components/nav`. Measurement error, not a generator failure.

## Reversal

| Task | with (`wee destroy`) | without (fresh undo agent) |
|---|---|---|
| model Post | 1 command, clean except init/db:init leftovers | 21 tool uses, 141,902 billed, clean |
| job SendWelcome | drift, needed `--force`, 4 leftovers (init) | 18 tool uses, 123,055 billed, clean |
| resource Post | 1 command, 10 leftovers (init/db:init + hand edits) | 17 tool uses, 84,720 billed, clean |

## Notes

- `job` is the one task where the CLI cost more. The agent ran `wee init`
  first, the generators did not install vitest, and the generated stub still
  needed the real logic by hand. The without arm wrote 79 lines and stopped.
- The `with` resource arm added by hand: a Nav in `layout.tsx`, `bunfig.toml`,
  `src/test/preload.ts` mocking `server-only`, vitest and `@types` deps,
  `bun pm trust`.
- The `without` resource arm switched `bun:sqlite` to `better-sqlite3`
  because `next build` collects page data in a Node worker.
- `bunx wee` also resolves in the `without` copies through the global bun
  link. The prompt forbade it and no `.app/manifests` appeared there.
