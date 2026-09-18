/** AGENTS.md for a generated app: how a coding agent drives `wee` there. */
import type { PackageManagerName } from "nypm"
import { weeCommand } from "./ops.js"

const agentsTemplate = (pm: PackageManagerName): string => {
  const wee = weeCommand(pm)
  return `# Agent guide

This app is driven by the \`wee\` CLI. Use a generator before you write boilerplate by hand.

## Rules

- Run \`${wee} about\` first to confirm the target.
- Read \`CONVENTIONS.md\` before you add a file by hand. It lists where each file kind lives.
- Prefer \`--json\` for machine-readable output and \`--dry-run\` to preview a change.
- Do not edit code between \`wee:begin <id>\` and \`wee:end <id>\` markers. \`${wee} destroy <generator> <Name>\` removes it.
- Run \`${wee} ci\` before you hand off. It runs the steps in \`config/ci.ts\` and stops at the first failure.

## Common commands

| Command | Outcome |
|---|---|
| \`${wee} g resource <Name> <attr:type...>\` | Model, migration, validator, service, actions, form, pages, nav link, e2e test |
| \`${wee} g model <Name> <attr:type...>\` | Model, schema export, validator, service, migration |
| \`${wee} g page <segment>\`, \`g layout\`, \`g handler\`, \`g component\`, \`g action\`, \`g form\` | Route and UI files with tests |
| \`${wee} g auth\`, \`g job\`, \`g email\`, \`g env\`, \`g proxy\` | Auth, Inngest jobs, React Email, env vars, request interceptors |
| \`${wee} db:migrate\`, \`db:status\`, \`db:rollback\`, \`db:prepare\`, \`db:reset\` | Migration lifecycle |
| \`${wee} dev\`, \`build\`, \`start\`, \`lint\`, \`typecheck\`, \`test\`, \`test:e2e\`, \`ci\` | Run and check the app |
| \`${wee} creds:edit --env=<name>\`, \`creds:show\`, \`creds:sync --target=vercel\` | Encrypted credentials in \`config/credentials/\` |
| \`${wee} routes\`, \`stats\`, \`notes\`, \`console\`, \`runner <expr>\` | Inspect routes, code size, TODO annotations; evaluate code against the database |

Attribute types: \`string text integer decimal boolean datetime uuid json enum[a,b] references\`. Modifiers: \`unique index optional default=<v>\`.
`
}

export { agentsTemplate }
