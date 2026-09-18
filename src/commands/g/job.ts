/**
 * `wee g job <Name>`: a plain job function in `jobs/<name>.ts` with a test,
 * registered in `jobs/index.ts`.
 */
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import {
  JOBS_ANCHORS,
  jobNames,
  jobsIndexTemplate,
  jobTemplate,
  jobTestTemplate,
} from "../../templates/jobs.js"
import { assertBlockAbsent, create, srcPath } from "./paths.js"
import { installRows, rowsOf, skipInstallArg } from "./setup.js"

const jobGenerator = defineGenerator({
  name: "job",
  description: "Job function with a test, registered in jobs/index.ts",
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
    const index = srcPath(ctx, "jobs", "index.ts")
    const file = srcPath(ctx, "jobs", `${names.file}.ts`)
    const marker = `job-${names.file}`
    assertBlockAbsent(ctx, index, marker)
    return [
      { kind: "ensure", path: index, content: jobsIndexTemplate() },
      create(ctx, file, jobTemplate(names)),
      create(
        ctx,
        srcPath(ctx, "jobs", `${names.file}.test.ts`),
        jobTestTemplate(names)
      ),
      {
        kind: "inject",
        path: index,
        marker: `${marker}-import`,
        content: `import { ${names.fn} } from "./${names.file}"`,
        after: JOBS_ANCHORS.imports,
      },
      {
        kind: "inject",
        path: index,
        marker,
        content: `  ${names.fn},`,
        after: JOBS_ANCHORS.list,
      },
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
      dependencies: ["zod"],
      devDependencies: [],
      skipInstall: args["skip-install"],
    })
    return { ...result, data: [...rowsOf(result.data), ...rowsOf(extra)] }
  },
})

export { job, jobGenerator }
