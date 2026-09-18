# Auth, jobs and mail flow

How `g auth`, `g auth:provider`, `g job`, `g email` and `mail:preview` fit together. The spec has no shape for these generators, so this document is the reference. Each generator writes one manifest and `destroy` reverses it.

## Shared parts

Every generator in this flow adds its variables to `.env.example` as one injected block (`auth`, `auth-provider-<id>`, `jobs`, `mail`). The block is written once; the first run owns it and later runs skip it. `g auth` records `auth: { provider }` and the first `g job` records `jobs: { provider: "inngest" }` in `.app/config.json`. Packages are installed through the package manager unless `--skip-install` is set; a dry run prints a note with the names instead.

Files shared between runs (`jobs/index.ts`, `lib/inngest.ts`, `lib/mail.ts`, the API routes) are `ensure` changes. `destroy` keeps a shared file while another manifest lists it or a `wee:begin` marker of another run is still inside.

## g auth

`g auth --provider=placeholder` writes `lib/auth/index.ts` only. `getSession()` returns a fixed user outside production and `null` in production, so pages can call `requireSession()` before a real provider exists. `auth.api.getSession()` has the Better Auth shape, so the `console` `auth` scope and the generated code do not change when the provider does.

`g auth --provider=better-auth` needs `db:init` first. It asks the adapter for the four Better Auth models (User, Session, Account, Verification) one by one, passing the pending changes so a model can reference a file created earlier in the same run, and writes one `create_auth_tables` migration whose down file drops the tables in reverse order. It then writes `lib/auth/index.ts` (the `betterAuth` instance on the app's database adapter, `emailAndPassword` enabled, `nextCookies` plugin, `getSession` and `requireSession`), `lib/auth/providers.ts` (the `socialProviders` object with an inject anchor), `lib/auth/client.ts` (`createAuthClient`), `app/api/auth/[...all]/route.ts`, `app/sign-in/page.tsx` and `components/auth/sign-in-form.tsx` with a test. Run `db:migrate` afterwards. The manifest is named after the provider, so `destroy auth better-auth` takes the models and the migration back.

`requireSession` imports `next/navigation` lazily. `wee console` loads `lib/auth/index.ts` under the `react-server` condition, where a top-level import of `next/navigation` fails.

## g auth:provider

`g auth:provider GitHub` lowercases the name to the Better Auth id (`github`), injects `github: { clientId, clientSecret }` after the anchor in `lib/auth/providers.ts` and adds `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` to `.env.example`. The sign-in form renders one button per id in `socialProviderIds`. The id is not validated against Better Auth's list; `typecheck` reports an unknown id through the `satisfies` clause in `providers.ts`.

## g job

`g job SendWelcome` writes `jobs/send-welcome.ts`: a Zod input schema, a pure `sendWelcome(input)` function and the Inngest function `sendWelcomeJob` with id `send-welcome` and event `<app>/send-welcome`, where `<app>` is the kebab-case target name. The test calls the pure function. The run injects an import block and a list entry into `jobs/index.ts`, which exports the `functions` array that `app/api/inngest/route.ts` serves. The first run also writes `lib/inngest.ts` with the client. The `Job` suffix is stripped from the name, so `SendWelcomeJob` and `SendWelcome` are the same job.

## g email and mail:preview

`g email Welcome` writes `emails/welcome.tsx`, a React Email component named `WelcomeEmail` with `PreviewProps`, and a test that renders it with `@react-email/render`. The component also has a default export because the preview tool requires one. The first run writes `lib/mail.ts` with `sendMail({ to, subject, react })` on top of Resend; it throws when Resend returns an error. `mail:preview` runs the React Email dev server on `src/emails` and fails with `emails-missing` when the directory does not exist.
