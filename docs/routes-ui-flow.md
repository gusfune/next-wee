# Routes and UI flow

How the phase 2 generators turn a segment or a name into files, how the
shared files grow, and how `destroy` takes it all back.

## Segments

`g page`, `g layout`, `g handler`, `g metadata` and `g action` take a
segment such as `posts/[id]/comments`, `(marketing)` or `api/posts`.
`src/lib/segment.ts` parses it once. Static parts, `(group)` parts and
`[id]`, `[...slug]`, `[[...slug]]` params are accepted. The parsed segment
gives the directory under `app/`, the URL with groups removed, a typed
`params` shape and a manifest key (`posts-id-comments`). The manifest key
is what `destroy` takes: `wee destroy page posts/[id]/comments` works
because both sides run the same kebab-case function.

## One file per run

`page`, `layout`, `handler`, `metadata`, `component`, `form`, `hook`,
`helper`, `provider` and `type` write whole files with `create`. When a
file exists the run fails with `file-exists` unless `--force`, which
turns the change into `modify` and records the previous content so
`destroy` restores it.

## Shared files

`env.ts`, `proxy.ts`, `lib/actions.ts` and `app/<segment>/actions.ts` are
shared by several runs. The first run creates them with the `ensure`
change kind. Each run then injects a marker block:

- `g env` injects `NAME: z.string(),` after the `serverSchema` or
  `clientSchema` anchor, a `process.env` read for client variables, and a
  `NAME=` line in `.env.example`.
- `g proxy` injects one interceptor after the `interceptors` anchor and
  the matcher strings after the `matcher: [` anchor. `config.matcher`
  stays a literal array so Next.js can read it at build time.
- `g action` injects one block per action. `create`, `update` and
  `remove` import the validator and the service; the block name is
  `create<Model>` and so on. Any other name gives a generic action named
  `<name><Model>` with a stub body.

A second run against the same marker fails with `block-exists` unless
`--force`, which replaces the block.

## Destroy

`destroy` reverses the manifest in reverse order. Marker blocks are
removed. An `ensure` file is deleted only when the file has no other
`wee:begin` block and no other manifest lists it. So the second `g env`
run can be destroyed while the first keeps `env.ts`, and `lib/actions.ts`
survives until both the form and the action runs are gone.

## Generated tests

Component, form, hook, helper, provider and handler runs write a Vitest
test next to the file. The React tests render with `react-dom/server` so
the app needs no testing library. The handler test calls the exported
methods directly with a stub `NextRequest` (`{ json }`), so it needs no
server either. The React tests are `.tsx` files, so the app's Vitest must
compile JSX: `"jsx": "react-jsx"` in `tsconfig.json` is enough for Vite.

## Checked in CI

`test/routes-ui.test.ts` runs every generator into a scratch copy of
`fixtures/single-repo`, typechecks the result with a Next-style
`tsconfig.json`, runs the generated tests, then destroys each run and
checks the file tree equals the tree after `g model Post`.
