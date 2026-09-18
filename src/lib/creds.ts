/**
 * Encrypted credentials for the target app. One age key pair per app:
 * the public key lives in `config/credentials/.age-recipients` (committed),
 * the private key in `config/credentials/.age-identity` (git-ignored) or in
 * `WEE_CREDENTIALS_KEY`. Each environment has one `<env>.env.enc` file that
 * holds a dotenv text.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseEnv } from "node:util"
import { Decrypter, Encrypter } from "age-encryption"
import { WeeError } from "../core/errors.js"

const CREDENTIALS_DIR = join("config", "credentials")
const RECIPIENTS_FILE = ".age-recipients"
const IDENTITY_FILE = ".age-identity"
const IDENTITY_ENV = "WEE_CREDENTIALS_KEY"

interface CredentialPaths {
  dir: string
  recipients: string
  identity: string
}

/** Target-relative paths of the credentials folder and its key files. */
const credentialPaths = (): CredentialPaths => ({
  dir: CREDENTIALS_DIR,
  recipients: join(CREDENTIALS_DIR, RECIPIENTS_FILE),
  identity: join(CREDENTIALS_DIR, IDENTITY_FILE),
})

/** Target-relative path of one environment's ciphertext. */
const credentialFile = (env: string): string =>
  join(CREDENTIALS_DIR, `${env}.env.enc`)

/** First line of a fresh credentials file. */
const credentialHeader = (env: string): string =>
  `# Credentials for ${env}. Edit with: wee creds:edit --env=${env}\n`

/**
 * The private key: `WEE_CREDENTIALS_KEY` wins, else the identity file in
 * `dir`. CI sets the variable; developers keep the file.
 */
const resolveIdentity = (dir: string): string => {
  const fromEnv = process.env[IDENTITY_ENV]
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv.trim()
  }
  const file = join(dir, IDENTITY_FILE)
  if (existsSync(file)) {
    return readFileSync(file, "utf8").trim()
  }
  throw new WeeError(
    "credentials-key-missing",
    `No ${IDENTITY_ENV} in the environment and no ${file}. Run "wee creds:init" or set the variable.`
  )
}

/** Public keys from the recipients file, one per line. */
const readRecipients = (dir: string): string[] => {
  const file = join(dir, RECIPIENTS_FILE)
  if (!existsSync(file)) {
    throw new WeeError(
      "credentials-missing",
      `No ${file}. Run "wee creds:init" first.`
    )
  }
  const recipients = readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
  if (recipients.length === 0) {
    throw new WeeError("credentials-missing", `${file} lists no recipients`)
  }
  return recipients
}

const encryptText = async (
  text: string,
  recipients: string[]
): Promise<Uint8Array> => {
  const encrypter = new Encrypter()
  for (const recipient of recipients) {
    encrypter.addRecipient(recipient)
  }
  return encrypter.encrypt(text)
}

const decryptText = async (
  bytes: Uint8Array,
  identity: string
): Promise<string> => {
  const decrypter = new Decrypter()
  decrypter.addIdentity(identity)
  try {
    return await decrypter.decrypt(bytes, "text")
  } catch (error) {
    throw new WeeError(
      "credentials-undecryptable",
      `Cannot decrypt the credentials with the given key: ${String(error)}`
    )
  }
}

/** Decrypts `<env>.env.enc` under `targetPath`. */
const readCredentials = async (
  targetPath: string,
  env: string
): Promise<string> => {
  const file = join(targetPath, credentialFile(env))
  if (!existsSync(file)) {
    throw new WeeError(
      "credentials-missing",
      `No ${credentialFile(env)}. Run "wee creds:edit --env=${env}" to create it.`
    )
  }
  const identity = resolveIdentity(join(targetPath, CREDENTIALS_DIR))
  return decryptText(new Uint8Array(readFileSync(file)), identity)
}

/** Key/value pairs of a dotenv text. Comments and blank lines are dropped. */
const parseCredentials = (text: string): Record<string, string> => {
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (value !== undefined) {
      values[key] = value
    }
  }
  return values
}

export type { CredentialPaths }
export {
  CREDENTIALS_DIR,
  credentialFile,
  credentialHeader,
  credentialPaths,
  decryptText,
  encryptText,
  IDENTITY_ENV,
  IDENTITY_FILE,
  parseCredentials,
  RECIPIENTS_FILE,
  readCredentials,
  readRecipients,
  resolveIdentity,
}
