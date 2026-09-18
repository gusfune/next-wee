/** Templates of `wee g job`: one plain function per job and the registry in `jobs/index.ts`. */
import { camelCase, kebabCase, pascalCase } from "../lib/inflect.js"

const JOBS_ANCHORS = {
  imports: "// wee:jobs imports",
  list: "const jobs = [",
}

const jobsIndexTemplate =
  (): string => `/** Every job in the app. \`wee g job\` registers one per job. */
${JOBS_ANCHORS.imports}

${JOBS_ANCHORS.list}
]

export { jobs }
`

interface JobNames {
  /** `SendWelcome` */
  name: string
  /** `send-welcome` */
  file: string
  /** `sendWelcome` */
  fn: string
}

const jobNames = (raw: string): JobNames => {
  const name = pascalCase(raw).replace(/Job$/, "")
  const file = kebabCase(name)
  return {
    name,
    file,
    fn: camelCase(name),
  }
}

const jobTemplate = (names: JobNames): string => `/**
 * ${names.name} job. A plain async function with a validated input, so the
 * test calls it directly and any queue or scheduler can run it later.
 */
import { z } from "zod"

const ${names.fn}Input = z.object({
  // Describe the job payload here.
})

type ${names.name}Input = z.infer<typeof ${names.fn}Input>

const ${names.fn} = async (input: ${names.name}Input): Promise<{ received: ${names.name}Input }> => {
  return { received: input }
}

export type { ${names.name}Input }
export { ${names.fn}, ${names.fn}Input }
`

const jobTestTemplate = (
  names: JobNames
): string => `import { describe, expect, it } from "vitest"
import { ${names.fn} } from "./${names.file}"

describe("${names.fn}", () => {
  it("returns what it received", async () => {
    await expect(${names.fn}({})).resolves.toEqual({ received: {} })
  })
})
`

export type { JobNames }
export {
  JOBS_ANCHORS,
  jobNames,
  jobsIndexTemplate,
  jobTemplate,
  jobTestTemplate,
}
