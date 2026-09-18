/** `wee mail:preview [--port]`: the React Email preview server over `emails/`. */
import { defineWeeCommand } from "../core/command.js"
import { WeeError } from "../core/errors.js"
import { runBin } from "../lib/packages.js"
import { EMAILS_DIR } from "./g/email.js"
import { exists, srcPath } from "./g/paths.js"

const mailPreview = defineWeeCommand({
  meta: {
    name: "mail:preview",
    description: "Preview the emails in a browser",
  },
  args: {
    port: {
      type: "string",
      description: "Port of the preview server",
      default: "3001",
    },
  },
  run: async (ctx, args) => {
    const dir = srcPath(ctx, EMAILS_DIR)
    if (!exists(ctx, dir)) {
      throw new WeeError(
        "emails-missing",
        `No ${dir}/ folder. Run "wee g email <Name>" first.`
      )
    }
    await runBin({
      targetPath: ctx.target.path,
      name: "react-email",
      bin: "email",
      args: ["dev", "--dir", dir, "--port", args.port],
      stdio: "inherit",
    })
    return undefined
  },
})

export { mailPreview }
