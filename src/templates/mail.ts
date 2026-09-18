/** Templates of `wee g email`: the Resend sender and one React Email component per mail. */
import { kebabCase, pascalCase, titleCase } from "../lib/inflect.js"

const MAIL_ENV = ["RESEND_API_KEY", "MAIL_FROM"]

const mailLibTemplate = (): string => `/**
 * Sends a React Email component through Resend. \`RESEND_API_KEY\` and
 * \`MAIL_FROM\` come from the environment; both are read at send time so
 * jobs and tests can import this module without them.
 */
import type { ReactElement } from "react"
import { Resend } from "resend"

interface SendMailOptions {
  to: string | string[]
  subject: string
  react: ReactElement
}

const sendMail = async (options: SendMailOptions): Promise<{ id: string }> => {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const { data, error } = await resend.emails.send({
    from: process.env.MAIL_FROM ?? "no-reply@example.com",
    ...options,
  })
  if (error !== null || data === null) {
    throw new Error(error?.message ?? "Resend returned no id")
  }
  return { id: data.id }
}

export type { SendMailOptions }
export { sendMail }
`

interface EmailNames {
  /** `WelcomeEmail` */
  component: string
  /** `welcome` */
  file: string
  /** `Welcome` */
  title: string
}

const emailNames = (raw: string): EmailNames => {
  const name = pascalCase(raw).replace(/Email$/, "")
  return {
    component: `${name}Email`,
    file: kebabCase(name),
    title: titleCase(name),
  }
}

/**
 * The preview tool (\`wee mail:preview\`) loads the default export and
 * \`PreviewProps\`; that is the one place a default export is required.
 */
const emailTemplate = (names: EmailNames): string => `import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components"

interface ${names.component}Props {
  name: string
}

const ${names.component} = ({ name }: ${names.component}Props) => (
  <Html lang="en">
    <Head />
    <Preview>${names.title}</Preview>
    <Body>
      <Container>
        <Heading as="h1">${names.title}</Heading>
        <Text>{\`Hello \${name}.\`}</Text>
      </Container>
    </Body>
  </Html>
)

${names.component}.PreviewProps = { name: "Ada" } satisfies ${names.component}Props

export type { ${names.component}Props }
export { ${names.component} }
export default ${names.component}
`

const emailTestTemplate = (
  names: EmailNames
): string => `import { render } from "@react-email/components"
import { describe, expect, it } from "vitest"
import { ${names.component} } from "./${names.file}"

describe("${names.component}", () => {
  it("renders the greeting", async () => {
    const html = await render(<${names.component} name="Ada" />)
    expect(html).toContain("Hello Ada.")
  })
})
`

export type { EmailNames }
export {
  emailNames,
  emailTemplate,
  emailTestTemplate,
  MAIL_ENV,
  mailLibTemplate,
}
