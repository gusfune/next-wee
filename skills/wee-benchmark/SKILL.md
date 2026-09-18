---
name: wee-benchmark
description: Benchmark one generator task from a single prompt, once with wee and once by hand, and write a comparison report. Use when asked to measure what wee saves or costs on a task.
---

# wee benchmark

One prompt, two arms, one report. Arm `with` may use `wee`. Arm `without` writes everything by hand. Both start from the same copy of the baseline app and pass the same checks. The report shows the delta.

## Inputs

- `baseline`: path to a Next.js app-router app that installs and builds on its own. `bunx create-next-app@latest bench-app --ts --app --src-dir --no-tailwind --no-eslint` is enough. The fixtures under `fixtures/` are not enough; they have no install.
- `task`: an id from the catalog below, or a custom prompt plus a check command.
- `slug`: short name for this run, e.g. `resource-post`.

## Rules

Both arms get the same task prompt word for word. Run each arm as a fresh subagent in its own directory. Do not run the arms in one agent; the second arm would see the first arm's files and reasoning. Do not fix an arm's output after it reports. A failed check is a result. The `without` arm must not find `wee` on its path: unlink it or set `PATH` without the bin.

## Procedure

Warning: step 1 copies the app with `rsync --delete` into `/tmp/wee-bench/<slug>/`. Pick a slug that is not in use.

1. Prepare two copies and commit the baseline in each, so the diff is measurable.

   ```sh
   for arm in with without; do
     dir=/tmp/wee-bench/<slug>/$arm
     mkdir -p "$dir"
     rsync -a --delete --exclude node_modules --exclude .git "<baseline>/" "$dir/"
     printf "DATABASE_URL=./local.sqlite\n" > "$dir/.env"
     (cd "$dir" && bun install && git init -q && git add -A && git commit -qm baseline)
   done
   ```

2. Link `wee` in the `with` copy only: `cd /tmp/wee-bench/<slug>/with && bun link next-wee`. Confirm with `bunx wee about`. Confirm `bunx wee` fails in the `without` copy.

3. Record `date +%s` and spawn the `with` arm with the prompt from "Arm prompts". Record `date +%s` when it reports. Repeat for the `without` arm. Run them in parallel when the machine allows it; the clock then measures wall time per arm, which is still comparable.

4. Run the checks in each copy, in this order, and record pass or fail per line:

   ```sh
   cd /tmp/wee-bench/<slug>/<arm>
   bunx tsc --noEmit
   bun test
   bunx next build
   <task check>
   ```

5. Measure the diff in each copy:

   ```sh
   git add -A && git diff --cached --shortstat && git diff --cached --name-only | wc -l
   ```

6. Measure reversibility. In `with`: run the `wee destroy` line from the catalog, then `git status --short` must print nothing. In `without`: spawn a fresh subagent with "Remove everything the previous change added for: <task prompt>. Report the tool calls used." Then `git status --short` must print nothing. Record the tool calls.

7. Write the report to `benchmarks/<date>-<slug>.md` with the template below. Leave the copies under `/tmp/wee-bench/<slug>/` until the report is reviewed.

## Arm prompts

Send the task prompt under a two-line header. `<task prompt>` is the catalog text, unchanged.

Arm `with`:

```
Work in <dir>. The `wee` CLI is installed; run `bunx wee about` first and use `wee` generators for every step they cover. Read AGENTS.md from the wee package for the command list.
<task prompt>
Finish with: the count of tool calls you made, the count of turns, and every error you hit.
```

Arm `without`:

```
Work in <dir>. Write every file by hand with the libraries the task names. Do not install or run any scaffolding CLI.
<task prompt>
Finish with: the count of tool calls you made, the count of turns, and every error you hit.
```

The counts are self-reported by the subagent. Mark them as such in the report.

## Task catalog

Each task names the prompt, the check that runs after the common checks, and the destroy line for the `with` arm. Step 1 writes `DATABASE_URL` to `.env`; the auth task also needs `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL=http://localhost:3000`.

`model-post`

- Prompt: "Set up Drizzle with SQLite, then add a Post model with `title` (required string), `body` (optional text) and `status` (enum: draft, published). I need the table migrated, a Zod validator with a test, and a service with list, get, create, update and remove."
- Check: `bunx wee runner "typeof (await services.posts.createPost({ title: 'a', status: 'draft' })).id"` prints `string` (run it from the `with` copy's link; for `without`, run the same call as a one-line `bun` script that imports the service).
- Destroy: `wee destroy model Post`. `db:init` has no destroy, so `.app/`, `drizzle.config.ts` and `src/db/` remain; list them as leftovers in both arms.

`resource-post`

- Prompt: "The app has Drizzle set up. Add a Post resource with `title` (required string) and `body` (optional text): model, migration, server actions for create, update and remove, a form, and list, new, show and edit pages under `/posts`, with loading and error boundaries."
- Check: `bunx next build` lists `/posts`, `/posts/new`, `/posts/[id]` and `/posts/[id]/edit`.
- Destroy: `wee destroy resource Post`.

`auth-better-auth`

- Prompt: "The app has Drizzle set up. Add Better Auth with email and password sign-in: the user, session, account and verification tables migrated, the API route, a `getSession()` helper, a `requireSession()` helper that redirects to `/sign-in`, and a sign-in page with a sign-up toggle."
- Check: `bunx wee runner "typeof (await auth.api.signInEmail({ body: { email: 'a@b.co', password: 'password123' } })).token"` after a sign-up call with the same body prints `string`. For `without`, run the same two calls as a `bun` script.
- Destroy: `wee destroy auth better-auth`.

`job-send-welcome`

- Prompt: "Add a job `SendWelcome` with a validated input, a unit test, and a registry in `jobs/index.ts` that lists every job."
- Check: `bun test src/jobs` passes and `src/jobs/index.ts` exports a `jobs` array containing `sendWelcome`.
- Destroy: `wee destroy job SendWelcome`.

`email-welcome`

- Prompt: "Add a Welcome email built with React Email that takes a `name` prop, a test that renders it, and a `sendMail` helper on Resend."
- Check: `bun test src/emails` passes.
- Destroy: `wee destroy email Welcome`.

## Metrics

| Metric | Source |
|---|---|
| Wall time (s) | `date +%s` around each arm |
| Tool calls, turns | Self-reported by the arm |
| Files changed, lines added, lines removed | `git diff --cached --shortstat` |
| Typecheck, tests, build, task check | Pass or fail per line from step 4 |
| Errors hit | The arm's final report |
| Reversal tool calls | 0 for a clean `wee destroy`; self-reported for `without` |
| Leftovers after reversal | Lines from `git status --short` |

## Report template

```markdown
# <slug> — <date>

Baseline: <path>, commit <sha>. Task: <task id>. Model: <model of the arms>.

| Metric | with wee | without wee |
|---|---|---|
| Wall time (s) | | |
| Tool calls (self-reported) | | |
| Turns (self-reported) | | |
| Files changed | | |
| Lines +/- | | |
| Typecheck | | |
| Tests | | |
| Build | | |
| Task check | | |
| Errors hit | | |
| Reversal tool calls | | |
| Leftovers after reversal | | |

## Notes

What each arm did differently, in prose. Name the files that only one arm wrote. Name every check that failed and the first line of its error.
```
