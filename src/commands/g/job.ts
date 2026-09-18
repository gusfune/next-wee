/**
 * `wee g job <Name>`: an Inngest function in `jobs/<name>.ts` with a test,
 * registered in `jobs/index.ts`. The first run also writes the client, the
 * `/api/inngest` route, the env keys and `jobs.provider` in the config.
 */
import { defineWeeCommand } from "../../core/command.js"
import { appSlug, assertAppRouter } from "../../core/context.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import {
  inngestClientTemplate,
  JOBS_ANCHORS,
  JOBS_ENV,
  jobNames,
  jobsIndexTemplate,
  jobsRouteTemplate,
  jobTemplate,
  jobTestTemplate,
} from "../../templates/jobs.js"
import { assertBlockAbsent, create, relativeImport, srcPath } from "./paths.js"
import {
  configPatch,
  envExampleChanges,
  installRows,
  rowsOf,
  skipInstallArg,
} from "./setup.js"

const jobGenerator = defineGenerator({
  name: "job",
  description: "Inngest job with a test, registered at /api/inngest",
  args: {
    name: {
      type: "positional",
      description: "Job name, e.g. SendWelcome",
      required: true,
    },
    ...skipInstallArg,
  },
  manifestName: (args) => jobNames(args.name).name,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const names = jobNames(args.name)
    const client = srcPath(ctx, "lib", "inngest.ts")
    const index = srcPath(ctx, "jobs", "index.ts")
    const route = srcPath(ctx, "app", "api", "inngest", "route.ts")
    const file = srcPath(ctx, "jobs", `${names.file}.ts`)
    const marker = `job-${names.file}`
    assertBlockAbsent(ctx, index, marker)
    return [
      {
        kind: "ensure",
        path: client,
        content: inngestClientTemplate(appSlug(ctx)),
      },
      { kind: "ensure", path: index, content: jobsIndexTemplate() },
      {
        kind: "ensure",
        path: route,
        content: jobsRouteTemplate({
          clientImport: relativeImport(route, client),
          jobsImport: relativeImport(route, index),
        }),
      },
      create(ctx, file, jobTemplate(names, relativeImport(file, client))),
      create(
        ctx,
        srcPath(ctx, "jobs", `${names.file}.test.ts`),
        jobTestTemplate(names)
      ),
      {
        kind: "inject",
        path: index,
        marker: `${marker}-import`,
        content: `import { ${names.job} } from "./${names.file}"`,
        after: JOBS_ANCHORS.imports,
      },
      {
        kind: "inject",
        path: index,
        marker,
        content: `  ${names.job},`,
        after: JOBS_ANCHORS.list,
      },
      ...envExampleChanges(ctx, "jobs", JOBS_ENV),
      ...(ctx.config.jobs === undefined
        ? [configPatch(ctx, { jobs: { provider: "inngest" } })]
        : []),
    ]
  },
})

const job = defineWeeCommand({
  meta: { name: "job", description: jobGenerator.description },
  args: jobGenerator.args,
  run: async (ctx, args) => {
    const result = await runGenerator({ ctx, generator: jobGenerator, args })
    const extra = await installRows({
      ctx,
      dependencies: ["inngest", "zod"],
      devDependencies: [],
      skipInstall: args["skip-install"],
    })
    return { ...result, data: [...rowsOf(result.data), ...rowsOf(extra)] }
  },
})

export { job, jobGenerator }
