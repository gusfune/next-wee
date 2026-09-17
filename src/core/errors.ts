/** Error type for every failure the CLI reports. The code is stable for `--json` consumers. */

interface WeeErrorOptions {
  exitCode?: number
  data?: unknown
}

class WeeError extends Error {
  readonly code: string
  readonly exitCode: number
  readonly data: unknown

  constructor(code: string, message: string, options: WeeErrorOptions = {}) {
    super(message)
    this.name = "WeeError"
    this.code = code
    this.exitCode = options.exitCode ?? 1
    this.data = options.data
  }
}

const isWeeError = (value: unknown): value is WeeError => {
  return value instanceof WeeError
}

export { isWeeError, WeeError }
