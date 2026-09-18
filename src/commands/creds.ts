/**
 * `wee creds:*`: age-encrypted credentials per environment. `init` makes
 * the key pair, `edit` opens the decrypted text in `$EDITOR`, `show`,
 * `fetch` and `diff` read it, `sync` pushes it to Vercel. Files are written
 * directly because the ciphertext is binary and not a generator output.
 */
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { generateIdentity, identityToRecipient } from "age-encryption"
import { x } from "tinyexec"
import type { CommandResult } from "../core/command.js"
import { defineWeeCommand } from "../core/command.js"
import type { Context } from "../core/context.js"
import { isWeeError, WeeError } from "../core/errors.js"
import type { Row } from "../core/output.js"
import {
  credentialFile,
  credentialHeader,
  credentialPaths,
  decryptText,
  encryptText,
  IDENTITY_FILE,
  parseCredentials,
  RECIPIENTS_FILE,
  readCredentials,
  readRecipients,
  resolveIdentity,
} from "../lib/creds.js"
import { appEnv } from "../lib/env.js"
import { packageBin } from "../lib/packages.js"

const envArg = {
  env: {
    type: "string",
    description: "Environment name (default: APP_ENV or local)",
  },
} as const

const envOf = (flag: string | undefined): string => flag ?? appEnv()

const row = (action: string, path: string): Row => ({ action, path })

/** Appends `line` to `file` under the target unless the file has it already. */
const appendLineOnce = (ctx: Context, file: string, line: string): boolean => {
  const full = join(ctx.target.path, file)
  const current = existsSync(full) ? readFileSync(full, "utf8") : ""
  if (current.split("\n").some((entry) => entry.trim() === line)) {
    return false
  }
  if (!ctx.flags.dryRun) {
    const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : ""
    appendFileSync(full, `${prefix}${line}\n`, "utf8")
  }
  return true
}

/** Encrypts `text` for the app's recipients and writes `<env>.env.enc`. */
const writeCredentials = async (
  ctx: Context,
  env: string,
  text: string
): Promise<string> => {
  const path = credentialFile(env)
  const dir = join(ctx.target.path, credentialPaths().dir)
  const bytes = await encryptText(text, readRecipients(dir))
  if (!ctx.flags.dryRun) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(ctx.target.path, path), bytes)
  }
  return path
}

const credsInit = defineWeeCommand({
  meta: {
    name: "creds:init",
    description: "Create the age key pair and the first credentials file",
  },
  run: async (ctx) => {
    const paths = credentialPaths()
    const dir = join(ctx.target.path, paths.dir)
    if (
      existsSync(join(ctx.target.path, paths.recipients)) &&
      !ctx.flags.force
    ) {
      throw new WeeError(
        "credentials-exist",
        `${paths.recipients} exists. Pass --force to replace the key pair; files encrypted for the old key stay unreadable.`
      )
    }
    const identity = await generateIdentity()
    const recipient = await identityToRecipient(identity)
    if (!ctx.flags.dryRun) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, RECIPIENTS_FILE), `${recipient}\n`, "utf8")
      const identityFile = join(dir, IDENTITY_FILE)
      writeFileSync(identityFile, `${identity}\n`, {
        encoding: "utf8",
        mode: 0o600,
      })
      chmodSync(identityFile, 0o600)
    }
    const ignored = appendLineOnce(ctx, ".gitignore", paths.identity)
    const env = appEnv()
    // The recipients file is on disk now (or the run is a dry run that
    // only needs the recipient string), so encrypt for that key directly.
    const bytes = await encryptText(credentialHeader(env), [recipient])
    const envFile = credentialFile(env)
    if (!ctx.flags.dryRun) {
      writeFileSync(join(ctx.target.path, envFile), bytes)
    }
    return {
      title: ctx.flags.dryRun ? "dry-run: creds:init" : "creds:init",
      data: [
        row("create", paths.recipients),
        row("create", paths.identity),
        ...(ignored ? [row("inject", ".gitignore")] : []),
        row("create", envFile),
      ],
    }
  },
})

/** `$VISUAL`, else `$EDITOR`, else `vi` on a terminal. */
const resolveEditor = (): string[] => {
  const raw = process.env.VISUAL ?? process.env.EDITOR
  const parts = (raw ?? "")
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (parts.length > 0) {
    return parts
  }
  if (process.stdin.isTTY === true) {
    return ["vi"]
  }
  throw new WeeError(
    "editor-missing",
    "Set EDITOR (or VISUAL) to edit credentials without a terminal."
  )
}

/** Current plaintext, or the header for a file that does not exist yet. */
const currentText = async (ctx: Context, env: string): Promise<string> => {
  if (!existsSync(join(ctx.target.path, credentialFile(env)))) {
    return credentialHeader(env)
  }
  return readCredentials(ctx.target.path, env)
}

const credsEdit = defineWeeCommand({
  meta: {
    name: "creds:edit",
    description: "Decrypt, open in $EDITOR, re-encrypt on close",
  },
  args: envArg,
  run: async (ctx, args) => {
    const env = envOf(args.env)
    const editor = resolveEditor()
    const [command, ...editorArgs] = editor
    if (command === undefined) {
      throw new WeeError("editor-missing", "EDITOR is empty")
    }
    const before = await currentText(ctx, env)
    const scratch = mkdtempSync(join(tmpdir(), "wee-creds-"))
    try {
      const file = join(scratch, `${env}.env`)
      writeFileSync(file, before, { encoding: "utf8", mode: 0o600 })
      const result = await x(command, [...editorArgs, file], {
        nodeOptions: { stdio: "inherit" },
        throwOnError: false,
      })
      if (result.exitCode !== 0) {
        throw new WeeError(
          "editor-failed",
          `${editor.join(" ")} exited with ${result.exitCode ?? "a signal"}`,
          { exitCode: result.exitCode ?? 1 }
        )
      }
      const after = readFileSync(file, "utf8")
      const path = credentialFile(env)
      if (after === before && existsSync(join(ctx.target.path, path))) {
        return { data: row("unchanged", path) }
      }
      return { data: row("edit", await writeCredentials(ctx, env, after)) }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  },
})

const credsShow = defineWeeCommand({
  meta: { name: "creds:show", description: "Print the decrypted values" },
  args: envArg,
  run: async (ctx, args) => {
    const env = envOf(args.env)
    return {
      data: parseCredentials(await readCredentials(ctx.target.path, env)),
    }
  },
})

const credsFetch = defineWeeCommand({
  meta: {
    name: "creds:fetch",
    description: "Print one decrypted value, for scripts",
  },
  args: {
    key: {
      type: "positional",
      description: "Variable name, e.g. API_KEY",
      required: true,
    },
    ...envArg,
  },
  run: async (ctx, args) => {
    const env = envOf(args.env)
    const values = parseCredentials(await readCredentials(ctx.target.path, env))
    const value = values[args.key]
    if (value === undefined) {
      throw new WeeError(
        "credential-missing",
        `${args.key} is not set in ${credentialFile(env)}`
      )
    }
    if (ctx.flags.json) {
      return { data: { key: args.key, value } }
    }
    process.stdout.write(`${value}\n`)
    return undefined
  },
})

/** `<pm> exec`-style prefix that runs `wee` from the repo's dependencies. */
const execPrefix = (ctx: Context): string => {
  switch (ctx.repo.packageManager) {
    case "pnpm":
      return "pnpm exec"
    case "yarn":
      return "yarn"
    case "bun":
      return "bunx"
    default:
      return "npx"
  }
}

const GIT_ATTRIBUTE = "config/credentials/*.env.enc diff=wee_credentials"
const TEXTCONV_KEY = "diff.wee_credentials.textconv"

const enroll = async (ctx: Context): Promise<CommandResult> => {
  const added = appendLineOnce(ctx, ".gitattributes", GIT_ATTRIBUTE)
  const textconv = `${execPrefix(ctx)} wee creds:diff`
  if (!ctx.flags.dryRun) {
    const result = await x("git", ["config", TEXTCONV_KEY, textconv], {
      nodeOptions: { cwd: ctx.target.path },
      throwOnError: false,
    })
    if (result.exitCode !== 0) {
      throw new WeeError(
        "git-failed",
        `git config ${TEXTCONV_KEY} failed: ${result.stderr.trim()}`
      )
    }
  }
  return {
    title: "creds:diff --enroll",
    data: [
      row(added ? "inject" : "unchanged", ".gitattributes"),
      row("git-config", `${TEXTCONV_KEY}=${textconv}`),
    ],
  }
}

/**
 * Textconv mode: git calls this at the repo root with the ciphertext path,
 * so the identity is looked up next to that file, not in the target.
 */
const printDecrypted = async (ctx: Context, rawPath: string): Promise<void> => {
  const file = isAbsolute(rawPath) ? rawPath : resolve(ctx.cwd, rawPath)
  if (!existsSync(file)) {
    throw new WeeError("file-missing", `${rawPath} does not exist`)
  }
  const identity = resolveIdentity(dirname(file))
  const text = await decryptText(new Uint8Array(readFileSync(file)), identity)
  process.stdout.write(text)
}

const credsDiff = defineWeeCommand({
  meta: {
    name: "creds:diff",
    description: "Decrypt a file for git diff, or --enroll the textconv driver",
  },
  args: {
    path: {
      type: "positional",
      description: "Ciphertext path (git passes it to the textconv driver)",
      required: false,
    },
    enroll: {
      type: "boolean",
      description: "Register the git textconv driver for *.env.enc",
      default: false,
    },
    ...envArg,
  },
  run: async (ctx, args) => {
    if (args.enroll) {
      return enroll(ctx)
    }
    if (args.path !== undefined) {
      await printDecrypted(ctx, args.path)
      return undefined
    }
    throw new WeeError("usage", "Pass a file path or --enroll")
  },
})

const VERCEL_ENVIRONMENTS: Record<string, string> = {
  local: "development",
  preview: "preview",
  production: "production",
}

interface VercelCommand {
  command: string
  args: string[]
}

/** The `vercel` binary from the target's dependencies, else from PATH. */
const vercelCommand = (ctx: Context): VercelCommand => {
  try {
    return { command: "node", args: [packageBin(ctx.target.path, "vercel")] }
  } catch (error) {
    if (isWeeError(error) && error.code === "package-missing") {
      return { command: "vercel", args: [] }
    }
    throw error
  }
}

const pushToVercel = async (
  ctx: Context,
  vercel: VercelCommand,
  key: string,
  value: string,
  environment: string
): Promise<void> => {
  const proc = x(
    vercel.command,
    [...vercel.args, "env", "add", key, environment, "--force", "--yes"],
    {
      nodeOptions: { cwd: ctx.target.path, stdio: ["pipe", "pipe", "pipe"] },
      throwOnError: false,
    }
  )
  proc.process?.stdin?.end(value)
  const result = await proc
  if (result.exitCode !== 0) {
    throw new WeeError(
      "vercel-failed",
      `vercel env add ${key} ${environment} failed: ${result.stderr.trim()}`,
      { exitCode: result.exitCode ?? 1 }
    )
  }
}

const credsSync = defineWeeCommand({
  meta: {
    name: "creds:sync",
    description: "Push the decrypted values to a hosting target",
  },
  args: {
    target: {
      type: "string",
      description: "Hosting target (vercel)",
      default: "vercel",
    },
    ...envArg,
  },
  run: async (ctx, args) => {
    if (args.target !== "vercel") {
      throw new WeeError("invalid-target", "--target must be vercel")
    }
    const env = envOf(args.env)
    const environment = VERCEL_ENVIRONMENTS[env]
    if (environment === undefined) {
      throw new WeeError(
        "invalid-env",
        `No Vercel environment for "${env}". Use local, preview or production.`
      )
    }
    if (!existsSync(join(ctx.target.path, ".vercel", "project.json"))) {
      throw new WeeError(
        "vercel-not-linked",
        `${ctx.target.name} has no .vercel/project.json. Run "vercel link" first.`
      )
    }
    const values = parseCredentials(await readCredentials(ctx.target.path, env))
    const rows = Object.keys(values).map((key) => ({
      action: "sync",
      path: key,
      environment,
    }))
    if (ctx.flags.dryRun) {
      return { title: "dry-run: creds:sync", data: rows }
    }
    const vercel = vercelCommand(ctx)
    // One process per variable: the CLI has no batch form of `env add`.
    for (const [key, value] of Object.entries(values)) {
      await pushToVercel(ctx, vercel, key, value, environment)
    }
    return { title: "creds:sync", data: rows }
  },
})

export { credsDiff, credsEdit, credsFetch, credsInit, credsShow, credsSync }
