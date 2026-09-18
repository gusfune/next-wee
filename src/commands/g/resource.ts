/**
 * `wee g resource <Name> attr:type...`: the whole CRUD flow in one manifest.
 * Runs the model, action and form builders, writes the list, new, show and
 * edit pages with their boundaries, adds a nav link and a Playwright test.
 * `destroy resource <Name>` reverses all of it.
 */
import { join } from "node:path"
import type { ModelSpec } from "../../core/adapters.js"
import type { FileChange } from "../../core/changes.js"
import { readIfExists } from "../../core/changes.js"
import type { CommandResult } from "../../core/command.js"
import { defineWeeCommand } from "../../core/command.js"
import type { Context } from "../../core/context.js"
import { assertAppRouter } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { buildModelSpec, parseAttributes } from "../../lib/attributes.js"
import { kebabCase, plural } from "../../lib/inflect.js"
import { installPackages } from "../../lib/packages.js"
import type { Segment } from "../../lib/segment.js"
import { parseSegment } from "../../lib/segment.js"
import type { ResourceImports } from "../../templates/resource.js"
import {
  displayLibTemplate,
  displayLibTestTemplate,
  e2eTemplate,
  editPageTemplate,
  listPageTemplate,
  NAV_ANCHOR,
  navLinkBlock,
  navTemplate,
  newPageTemplate,
  showPageTemplate,
} from "../../templates/resource.js"
import { errorTemplate, loadingTemplate } from "../../templates/routes.js"
import { actionChanges, actionsPath } from "./action.js"
import { formChanges, formPath } from "./form.js"
import { modelChanges } from "./model.js"
import {
  assertBlockAbsent,
  create,
  relativeImport,
  segmentDir,
  srcPath,
} from "./paths.js"
import { attributeArgs, nameArg } from "./shared.js"

interface PageOptions {
  skipLoading: boolean
  skipError: boolean
}

type PageKind = "list" | "new" | "show" | "edit"

const PAGE_TEMPLATES = {
  list: listPageTemplate,
  new: newPageTemplate,
  show: showPageTemplate,
  edit: editPageTemplate,
} as const

/** `page.tsx` plus boundaries for one CRUD segment. */
const pageChanges = (
  ctx: Context,
  options: PageOptions & {
    kind: PageKind
    segment: Segment
    model: ModelSpec
    files: Record<keyof ResourceImports, string>
  }
): FileChange[] => {
  const { kind, segment, model, files, skipLoading, skipError } = options
  const dir = segmentDir(ctx, segment)
  const page = join(dir, "page.tsx")
  const imports: ResourceImports = {
    form: relativeImport(page, files.form),
    actions: relativeImport(page, files.actions),
    service: relativeImport(page, files.service),
    validator: relativeImport(page, files.validator),
    display: relativeImport(page, files.display),
  }
  const changes = [create(ctx, page, PAGE_TEMPLATES[kind]({ model, imports }))]
  if (!skipLoading) {
    changes.push(
      create(ctx, join(dir, "loading.tsx"), loadingTemplate(segment))
    )
  }
  if (!skipError) {
    changes.push(create(ctx, join(dir, "error.tsx"), errorTemplate(segment)))
  }
  return changes
}

/** Keeps the first `ensure` per path; sub-generators share `lib/actions.ts`. */
const dedupeEnsures = (changes: FileChange[]): FileChange[] => {
  const seen = new Set<string>()
  return changes.filter((change) => {
    if (change.kind !== "ensure") {
      return true
    }
    if (seen.has(change.path)) {
      return false
    }
    seen.add(change.path)
    return true
  })
}

const resourceGenerator = defineGenerator({
  name: "resource",
  description: "Model, actions, form, CRUD pages, nav link and e2e test",
  args: {
    ...nameArg,
    "skip-migration": {
      type: "boolean",
      description: "Do not write a migration",
      default: false,
    },
    "skip-loading": {
      type: "boolean",
      description: "Do not write loading.tsx files",
      default: false,
    },
    "skip-error": {
      type: "boolean",
      description: "Do not write error.tsx files",
      default: false,
    },
    "skip-install": {
      type: "boolean",
      description: "Do not install @playwright/test for the e2e test",
      default: false,
    },
  },
  manifestName: (args) => buildModelSpec(args.name, []).name,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const attributes = parseAttributes(attributeArgs(args._))
    if (attributes.length === 0) {
      throw new WeeError(
        "attributes-required",
        `${args.name}: pass at least one attribute, e.g. title:string`
      )
    }
    const model = buildModelSpec(args.name, attributes)
    const base = kebabCase(plural(model.name))
    const segments: Record<PageKind, Segment> = {
      list: parseSegment(base),
      new: parseSegment(`${base}/new`),
      show: parseSegment(`${base}/[id]`),
      edit: parseSegment(`${base}/[id]/edit`),
    }
    const files: Record<keyof ResourceImports, string> = {
      form: formPath(ctx, model),
      actions: actionsPath(ctx, segments.list),
      service: srcPath(ctx, "services", `${base}.ts`),
      validator: srcPath(
        ctx,
        "lib",
        "validators",
        `${kebabCase(model.name)}.ts`
      ),
      display: srcPath(ctx, "lib", "display.ts"),
    }
    const changes: FileChange[] = await modelChanges(ctx, {
      model,
      skipMigration: args["skip-migration"],
    })
    changes.push(
      ...actionChanges(ctx, {
        segment: segments.list,
        names: ["create", "update", "remove"],
        model,
        pending: changes,
      })
    )
    changes.push(...formChanges(ctx, { model, pending: changes }))
    const pageOptions: PageOptions = {
      skipLoading: args["skip-loading"],
      skipError: args["skip-error"],
    }
    for (const kind of ["list", "new", "show", "edit"] as const) {
      changes.push(
        ...pageChanges(ctx, {
          ...pageOptions,
          kind,
          segment: segments[kind],
          model,
          files,
        })
      )
    }
    const navFile = srcPath(ctx, "components", "nav.tsx")
    const navMarker = `nav-${base}`
    assertBlockAbsent(ctx, navFile, navMarker)
    changes.push(
      { kind: "ensure", path: files.display, content: displayLibTemplate() },
      {
        kind: "ensure",
        path: srcPath(ctx, "lib", "display.test.ts"),
        content: displayLibTestTemplate(),
      },
      { kind: "ensure", path: navFile, content: navTemplate() },
      {
        kind: "inject",
        path: navFile,
        marker: navMarker,
        content: navLinkBlock(model),
        after: NAV_ANCHOR,
      },
      create(ctx, join("e2e", `${base}.spec.ts`), e2eTemplate(model))
    )
    return dedupeEnsures(changes)
  },
})

const E2E_PACKAGE = "@playwright/test"

const hasPlaywright = (ctx: Context): boolean => {
  const text = readIfExists(join(ctx.target.path, "package.json")) ?? "{}"
  const pkg = JSON.parse(text) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  return (
    pkg.dependencies?.[E2E_PACKAGE] !== undefined ||
    pkg.devDependencies?.[E2E_PACKAGE] !== undefined
  )
}

/**
 * Rows after the generator ran: the Playwright install (the e2e spec fails
 * the app's typecheck without it) and a reminder to render `<Nav />` when
 * the root layout does not yet.
 */
const followUpRows = async (
  ctx: Context,
  skipInstall: boolean
): Promise<CommandResult["data"]> => {
  const rows: Record<string, string>[] = []
  if (!hasPlaywright(ctx)) {
    if (ctx.flags.dryRun || skipInstall) {
      rows.push({
        action: "note",
        path: `add ${E2E_PACKAGE} as a devDependency for e2e/`,
      })
    } else {
      await installPackages({
        ctx,
        dependencies: [],
        devDependencies: [E2E_PACKAGE],
      })
      rows.push({ action: "install", path: E2E_PACKAGE })
    }
  }
  const layout = srcPath(ctx, "app", "layout.tsx")
  const source = readIfExists(join(ctx.target.path, layout)) ?? ""
  if (!source.includes("<Nav")) {
    rows.push({
      action: "note",
      path: `render <Nav /> from components/nav.tsx in ${layout}`,
    })
  }
  return rows
}

const resource = defineWeeCommand({
  meta: { name: "resource", description: resourceGenerator.description },
  args: resourceGenerator.args,
  run: async (ctx, args) => {
    const result = await runGenerator({
      ctx,
      generator: resourceGenerator,
      args,
    })
    const rows = Array.isArray(result.data) ? result.data : [result.data]
    const extra = await followUpRows(ctx, args["skip-install"])
    return {
      ...result,
      data: [...rows, ...(Array.isArray(extra) ? extra : [extra])],
    }
  },
})

export { resource, resourceGenerator }
