/**
 * `wee g email <Name>`: a React Email component in `emails/<name>.tsx` with
 * a render test. The first run also writes `lib/mail.ts` (Resend) and the
 * env keys. `wee mail:preview` serves the folder.
 */
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import {
  emailNames,
  emailTemplate,
  emailTestTemplate,
  MAIL_ENV,
  mailLibTemplate,
} from "../../templates/mail.js"
import { create, srcPath } from "./paths.js"
import {
  envExampleChanges,
  installRows,
  rowsOf,
  skipInstallArg,
} from "./setup.js"

const EMAILS_DIR = "emails"

const emailGenerator = defineGenerator({
  name: "email",
  description: "React Email component with a test and the Resend sender",
  args: {
    name: {
      type: "positional",
      description: "Email name, e.g. Welcome",
      required: true,
    },
    ...skipInstallArg,
  },
  manifestName: (args) => emailNames(args.name).component,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const names = emailNames(args.name)
    return [
      {
        kind: "ensure",
        path: srcPath(ctx, "lib", "mail.ts"),
        content: mailLibTemplate(),
      },
      create(
        ctx,
        srcPath(ctx, EMAILS_DIR, `${names.file}.tsx`),
        emailTemplate(names)
      ),
      create(
        ctx,
        srcPath(ctx, EMAILS_DIR, `${names.file}.test.tsx`),
        emailTestTemplate(names)
      ),
      ...envExampleChanges(ctx, "mail", MAIL_ENV),
    ]
  },
})

const email = defineWeeCommand({
  meta: { name: "email", description: emailGenerator.description },
  args: emailGenerator.args,
  run: async (ctx, args) => {
    const result = await runGenerator({ ctx, generator: emailGenerator, args })
    const extra = await installRows({
      ctx,
      dependencies: ["@react-email/components", "resend"],
      devDependencies: ["react-email"],
      skipInstall: args["skip-install"],
    })
    return { ...result, data: [...rowsOf(result.data), ...rowsOf(extra)] }
  },
})

export { EMAILS_DIR, email, emailGenerator }
