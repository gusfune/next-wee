# Resource flow

How `wee g resource` composes the phase 1 and 2 generators into one CRUD
flow, what `routes` reads, and how `console` and `runner` load the app.

## One manifest

`g resource Post title:string body:text published:boolean` builds one
`FileChange` list and applies it once, so one manifest
(`.app/manifests/resource-post.json`) owns every file. The list is built
in this order:

1. `modelChanges` (from `g model`): schema file, schema index export,
   validator + test, service, create-table migration.
2. `actionChanges` (from `g action`): `lib/actions.ts`, `app/posts/actions.ts`
   and the `createPost`, `updatePost`, `removePost` blocks.
3. `formChanges` (from `g form`): `components/posts/post-form.tsx` + test.
4. Four pages with `loading.tsx` and `error.tsx`: `posts`, `posts/new`,
   `posts/[id]`, `posts/[id]/edit`.
5. `lib/display.ts` + test, `components/nav.tsx` with a `nav-posts` block,
   and `e2e/posts.spec.ts`.

The sub-generators check for files the earlier steps produce. Because
nothing is written until the whole list exists, those checks take the
pending list into account (`existsOrPending` in `commands/g/paths.ts`,
and the pending `action-create-post` inject marker for the form). Duplicate
`ensure` changes (`lib/actions.ts` comes from both the action and the form
builder) are collapsed to the first one.

`resolveAttributes` reads the `resource` manifest as well as the `model`
manifest, so `g validator Post` after `g resource Post` still finds the
attribute list.

## --api: REST handlers instead of the UI

`g resource Comment body:text --api` runs step 1 (model, validator,
service, migration) and then, instead of steps 2 to 5, writes two route
files under `app/api/`:

- `app/api/comments/route.ts`: `GET` parses `page` and `perPage` from the
  query string with `commentQuerySchema` (falling back to its defaults)
  and answers the `listComments` page; `POST` validates the JSON body
  with `insertCommentSchema`, answers 400 with the flattened field errors
  or 201 with the created row.
- `app/api/comments/[id]/route.ts`: `GET` answers the row or a 404
  `{ error }`; `PATCH` validates with `updateCommentSchema` (the partial
  schema), answering 400, 404 or the updated row; `DELETE` answers 404
  for a missing row, else 204.

No pages, form, nav link, display lib or Playwright spec, so the command
also skips the `@playwright/test` install and the `<Nav />` note. The
handlers import the service, which imports `"server-only"`, so — like
services — they get no Vitest unit test; the acceptance suite exercises
them against a migrated database through `wee runner`. The manifest is
still `resource-comment.json`, so `destroy resource Comment` reverses
the run.

## Pages

The list page parses `searchParams` with `postQuerySchema` (page, perPage),
calls `listPosts` and renders rows with a link, an Edit link and a Delete
form bound to `removePost`. The show page calls `getPost` and `notFound()`
when the row is missing, then renders every attribute plus `createdAt` and
`updatedAt` through `displayValue`. New and edit render `<PostForm />`.
Rows are shown by the first `string` attribute, else the first attribute,
else `id`.

## Nav link

`app/layout.tsx` is JSX, and marker comments are `//` lines, so the layout
is not injected. `components/nav.tsx` holds a `links` array between
markers; each resource adds one entry. The command prints a note until the
root layout contains `<Nav`.

## Playwright

`e2e/posts.spec.ts` drives create, read, update and delete through the
pages with relative `page.goto` calls (the base URL comes from the phase 5
Playwright config). Without `@playwright/test` the spec breaks the app's
typecheck, so `g resource` installs it as a devDependency; `--skip-install`
prints a note instead.

## routes

`lib/routes.ts` walks `app/`, skips `_private` folders, classifies each
directory (`static`, `dynamic`, `catch-all`, `optional-catch-all`, `group`,
`parallel`, `intercepting`) and each file (`page`, `layout`, `route` as
`handler`, metadata files). Groups and parallel slots add nothing to the
URL; intercepting prefixes are stripped. When `.next/prerender-manifest.json`
exists, pages and handlers get a rendering column: `routes` entries with
`initialRevalidateSeconds: false` are `static`, with a number `isr`,
`dynamicRoutes` entries are `static`, everything else `dynamic`. Verified
against `next build` output on the generated resource app.

## console and runner

Both commands spawn `runtime/preload.ts` inside the target app through
`runScript` (`lib/packages.ts`): `bun <script>` in bun repos, else
`node --import tsx <script>`. The preload is built to
`dist/runtime/preload.js` as a second tsdown entry; `commands/console.ts`
falls back to the source file when the build is absent (tests). The child
runs with `--conditions=react-server` so `"server-only"` in the services
resolves to its empty export.

The preload imports `src/db/client.ts` (`db`), the schema index (`schema`),
every `src/services/*.ts` keyed by camelCase file name (`services`), and
`src/lib/auth/index.ts` when present (`auth`). `console` opens a `node:repl`
with those names in context. `runner <expr>` wraps the expression in an
async function with the same parameters and prints the result with
`util.inspect`; `runner <file>` imports the file with the scope on
`globalThis` and calls its default export with the scope. Exit code is 1
when the result is `false` or the code throws, else 0.

`--sandbox` on SQLite runs `BEGIN` before and `ROLLBACK` after the session
on the single connection, so services roll back too. On Postgres and MySQL
the session runs inside `db.transaction` with the transaction handle as
`db`; services that import the pooled client still commit (see ROADMAP).
