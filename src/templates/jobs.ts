/** Templates of `wee g job`: Inngest client, one function per job, the registry and the API route. */
import { camelCase, kebabCase, pascalCase } from "../lib/inflect.js"

const JOBS_ENV = ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]

const JOBS_ANCHORS = {
  imports: "// wee:jobs imports",
  list: "const functions: InngestFunction.Any[] = [",
}

const inngestClientTemplate = (
  appId: string
): string => `/** Inngest client. Send events with \`inngest.send({ name, data })\`. */
import { Inngest } from "inngest"

const inngest = new Inngest({ id: "${appId}" })

export { inngest }
`

const jobsIndexTemplate =
  (): string => `/** Every job served at /api/inngest. \`wee g job\` adds one per job. */
import type { InngestFunction } from "inngest"
${JOBS_ANCHORS.imports}

${JOBS_ANCHORS.list}
]

export { functions }
`

const jobsRouteTemplate = (options: {
  clientImport: string
  jobsImport: string
}): string => `/** Inngest endpoint. The Inngest dev server and cloud call it to run the jobs. */
import { serve } from "inngest/next"
import { functions } from "${options.jobsImport}"
import { inngest } from "${options.clientImport}"

export const { GET, POST, PUT } = serve({ client: inngest, functions })
`

interface JobNames {
  /** `SendWelcome` */
  name: string
  /** `send-welcome` */
  file: string
  /** `sendWelcome` */
  fn: string
  /** `sendWelcomeJob` */
  job: string
  /** `app/send-welcome` */
  event: string
}

const jobNames = (raw: string): JobNames => {
  const name = pascalCase(raw).replace(/Job$/, "")
  const file = kebabCase(name)
  return {
    name,
    file,
    fn: camelCase(name),
    job: `${camelCase(name)}Job`,
    event: `app/${file}`,
  }
}

const jobTemplate = (names: JobNames, clientImport: string): string => `/**
 * ${names.name} job. Runs on the "${names.event}" event. The work is in
 * \`${names.fn}\`, a plain function, so the test calls it without Inngest.
 */
import { z } from "zod"
import { inngest } from "${clientImport}"

const ${names.fn}Input = z.object({
  // Describe the event payload here.
})

type ${names.name}Input = z.infer<typeof ${names.fn}Input>

const ${names.fn} = async (input: ${names.name}Input): Promise<{ received: ${names.name}Input }> => {
  return { received: input }
}

const ${names.job} = inngest.createFunction(
  { id: "${names.file}", triggers: [{ event: "${names.event}" }] },
  async ({ event, step }) => {
    const input = ${names.fn}Input.parse(event.data)
    return step.run("${names.file}", () => ${names.fn}(input))
  }
)

export type { ${names.name}Input }
export { ${names.fn}, ${names.fn}Input, ${names.job} }
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
  inngestClientTemplate,
  JOBS_ANCHORS,
  JOBS_ENV,
  jobNames,
  jobsIndexTemplate,
  jobsRouteTemplate,
  jobTemplate,
  jobTestTemplate,
}
