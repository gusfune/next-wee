# Plan

Delivery plan for `next-wee`, from `next-cli-spec.md` (draft 2). One phase at a time. The code of each phase gets a review before the next phase starts. Tick a box when the step is merged. Deferred items and known issues go to ROADMAP.md.

## Decisions

| Decision | Value |
|---|---|
| Package / bins | `next-wee`, `wee` and `we` |
| Runtime | Node 22+ (oldest supported LTS), plain ESM, no Bun-only APIs. Bun is used for development. |
| Arg parser | citty |
| Toolchain | Biome, Vitest, tsdown |
| `references` delete behaviour | restrict |
| Server action layout | one `actions.ts` per segment |
| Default list page | paginated with `searchParams` |
| Service layer | required for all database access |
| Test placement | beside the source |
| Injections | marker comments `wee:begin <id>` / `wee:end <id>`, reversed by `destroy` |

## Phase 0: Foundation

Acceptance: `wee about` runs in a single repo and in a Turborepo and reports the correct target.

- [x] Repo scaffold: package.json, tsconfig, biome, tsdown, vitest, fixtures
- [x] `core/repo.ts` repo detection (turbo.json, workspaces, pnpm-workspace.yaml, single)
- [x] `core/workspace.ts` target selection (`--app`, `--package`, single app, prompt or `--json` failure)
- [x] `core/config.ts` `.app/config.json` and root `app.config.json` merge
- [x] `core/changes.ts` FileChange model, apply, dry-run
- [x] `core/inject.ts` marker-based injection
- [x] `core/manifest.ts` manifest write/read/delete
- [x] `core/command.ts` global flags `--dry-run`, `--json`, `--force`, `--app`, `--package`
- [x] `core/generator.ts` generator contract and runner
- [x] `core/adapters.ts` `DbAdapter` and model types
- [x] `wee about`
- [x] `wee init` (config + `CONVENTIONS.md`)
- [x] `wee destroy <generator> <Name>` with drift check
- [x] Unit and integration tests over the fixtures
- [x] GitHub Actions: lint, typecheck, test, build on Node 22 and 24
- [x] `AGENTS.md` section for coding agents
- [ ] Phase review

## Phase 1: Database (Drizzle)

Acceptance: `g model` then `db:migrate` produces a queryable table and a passing validator test.

- [x] Attribute parser `name:type[:modifier...]` and the type map (Drizzle, Zod)
- [x] `DbAdapter` Drizzle implementation
- [x] `db:init --adapter=drizzle [--provider]` (installs through the detected package manager)
- [x] `db:generate`, `db:migrate`, `db:rollback`, `db:status`
- [x] `db:push` (local and preview only), `db:seed`, `db:seed:replant`
- [x] `db:prepare`, `db:reset` (refuses in production), `db:studio`, `db:console`
- [x] `g model` (model, schema index export, validator, service, migration, validator test)
- [x] `g migration` with Rails-style name parsing
- [x] `g validator`, `g service`
- [ ] Phase review

## Phase 2: Routes and UI

Acceptance: each generator emits, `destroy` reverses, `typecheck` passes after every run.

- [ ] `g page` with `loading.tsx`, `error.tsx`, `--layout`, `--skip-loading`, `--skip-error`
- [ ] `g layout`, `g handler --methods`, `g metadata --sitemap --og`
- [ ] `g component --area --client` with test
- [ ] `g form`, `g hook`, `g helper --shared`, `g provider`, `g type`
- [ ] `g env`, `g proxy --matcher`, `g action`
- [ ] Phase review

## Phase 3: Resource

Acceptance: `g resource Post` gives a CRUD flow that passes the generated e2e test.

- [ ] `g resource` composite with one manifest
- [ ] Nav link injection
- [ ] `routes [--grep]` with segment kinds and rendering mode
- [ ] `console [--sandbox]`, `runner <file|expr>`
- [ ] Phase review

## Phase 4: Adapters

Acceptance: `db:init --adapter=prisma` passes the phase 1 acceptance. Better Auth sign-in works in the resource app.

- [ ] Prisma `DbAdapter` (rollback fails with the manual procedure)
- [ ] `g auth --provider=placeholder`
- [ ] `g auth --provider=better-auth`
- [ ] `g auth:provider <Name>`
- [ ] `g job` (Inngest) with registration injection
- [ ] `g email`, `mail:preview`
- [ ] Phase review

## Phase 5: Operations

Acceptance: `wee ci` is green locally and in GitHub Actions on the resource app.

- [ ] `creds:init`, `creds:edit`, `creds:show`, `creds:diff`, `creds:fetch`, `creds:sync --target=vercel`
- [ ] `lint`, `typecheck`, `test`, `test:e2e`
- [ ] `dev`, `build`, `start` (Turborepo delegation)
- [ ] `ci` with `config/ci.ts`
- [ ] `stats`, `notes`
- [ ] `new <name>` with `--api`, `--minimal`, `--db`, `--auth`
- [ ] Full `AGENTS.md`
- [ ] Phase review

## Phase 6: Extensibility

Acceptance: a custom generator runs with `--dry-run`, `--json` and `destroy` without CLI changes.

- [ ] `g generator <Name>`
- [ ] `g task <name>`
- [ ] Custom generator loading from `tools/generators/`
- [ ] Phase review
