/**
 * Templates of `wee g auth` and `wee g auth:provider`. Both providers
 * export the same surface from `lib/auth/index.ts`: `auth`, `Session`,
 * `getSession()` and `requireSession()`, so pages and actions do not change
 * when the app moves from the placeholder to Better Auth.
 */
import type { DbProvider, ModelSpec } from "../core/adapters.js"
import { buildModelSpec, parseAttributes } from "../lib/attributes.js"

/** Tables Better Auth needs, in the shape `g model` takes. */
const AUTH_MODELS: readonly ModelSpec[] = [
  buildModelSpec(
    "User",
    parseAttributes([
      "name:string",
      "email:string:unique",
      "emailVerified:boolean:default=false",
      "image:string:optional",
    ])
  ),
  buildModelSpec(
    "Session",
    parseAttributes([
      "expiresAt:datetime",
      "token:string:unique",
      "ipAddress:string:optional",
      "userAgent:string:optional",
      "user:references",
    ])
  ),
  buildModelSpec(
    "Account",
    parseAttributes([
      "accountId:string",
      "providerId:string",
      "user:references",
      "accessToken:text:optional",
      "refreshToken:text:optional",
      "idToken:text:optional",
      "accessTokenExpiresAt:datetime:optional",
      "refreshTokenExpiresAt:datetime:optional",
      "scope:text:optional",
      "password:text:optional",
    ])
  ),
  buildModelSpec(
    "Verification",
    parseAttributes(["identifier:string", "value:text", "expiresAt:datetime"])
  ),
]

/** Better Auth's `provider` option for the Drizzle adapter. */
const DRIZZLE_PROVIDER: Record<DbProvider, string> = {
  postgres: "pg",
  sqlite: "sqlite",
  mysql: "mysql",
}

const AUTH_ENV = ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"]

const sessionBlock = `interface Session {
  user: {
    id: string
    name: string
    email: string
  }
}

/** The session, or \`null\` when nobody is signed in. Call it from server code. */`

const requireSessionBlock = `/** The session, or a redirect to \`/sign-in\`. Call it at the top of a protected page or action. */
const requireSession = async (): Promise<Session> => {
  const session = await getSession()
  if (session === null) {
    // Loaded here, not at the top: \`wee console\` imports this module under
    // the react-server condition, where next/navigation cannot load.
    const { redirect } = await import("next/navigation")
    return redirect("/sign-in")
  }
  return session
}`

/**
 * Placeholder: a fixed user outside production, nobody in production. Lets
 * the app build protected pages before an auth provider is chosen.
 */
const placeholderTemplate = (): string => `/**
 * Placeholder auth. Every request is signed in as \`PLACEHOLDER_USER\`
 * outside production, and signed out in production. Replace it with
 * \`wee g auth --provider=better-auth --force\`.
 */
${sessionBlock}
const getSession = async (): Promise<Session | null> =>
  process.env.NODE_ENV === "production" ? null : { user: PLACEHOLDER_USER }

const PLACEHOLDER_USER = {
  id: "placeholder",
  name: "Placeholder User",
  email: "placeholder@example.com",
}

${requireSessionBlock}

/** Same shape as the Better Auth instance, for code that calls \`auth.api\` directly. */
const auth = {
  api: {
    getSession: async (): Promise<Session | null> => getSession(),
  },
}

export type { Session }
export { auth, getSession, PLACEHOLDER_USER, requireSession }
`

interface BetterAuthOptions {
  adapter: "drizzle" | "prisma"
  provider: DbProvider
  /** Import specifier of `db/client`. */
  clientImport: string
  /** Import specifier of the Drizzle schema barrel. Unused for Prisma. */
  schemaImport: string
}

const databaseCode = (
  options: BetterAuthOptions
): {
  imports: string[]
  code: string
} => {
  if (options.adapter === "prisma") {
    return {
      imports: [`import { prismaAdapter } from "better-auth/adapters/prisma"`],
      code: `prismaAdapter(db, { provider: "${PRISMA_AUTH_PROVIDER[options.provider]}" })`,
    }
  }
  return {
    imports: [
      `import { drizzleAdapter } from "better-auth/adapters/drizzle"`,
      `import * as schema from "${options.schemaImport}"`,
    ],
    code: `drizzleAdapter(db, {
    provider: "${DRIZZLE_PROVIDER[options.provider]}",
    schema,
    usePlural: true,
  })`,
  }
}

const PRISMA_AUTH_PROVIDER: Record<DbProvider, string> = {
  postgres: "postgresql",
  sqlite: "sqlite",
  mysql: "mysql",
}

const betterAuthTemplate = (options: BetterAuthOptions): string => {
  const database = databaseCode(options)
  return `/**
 * Better Auth server instance. Email + password is on; social providers
 * come from ./providers (\`wee g auth:provider <Name>\` adds one). The
 * \`nextCookies\` plugin sets cookies from server actions.
 */
import { betterAuth } from "better-auth"
${database.imports.join("\n")}
import { nextCookies } from "better-auth/next-js"
import { headers } from "next/headers"
import { db } from "${options.clientImport}"
import { socialProviders } from "./providers"

const auth = betterAuth({
  database: ${database.code},
  emailAndPassword: { enabled: true },
  socialProviders,
  plugins: [nextCookies()],
})

${sessionBlock}
const getSession = async (): Promise<Session | null> => {
  const session = await auth.api.getSession({ headers: await headers() })
  return session === null ? null : { user: session.user }
}

${requireSessionBlock}

export type { Session }
export { auth, getSession, requireSession }
`
}

const PROVIDERS_ANCHOR = "const socialProviders = {"

const providersTemplate = (): string => `/**
 * Social sign-in providers. \`wee g auth:provider <Name>\` adds a block per
 * provider and the matching keys to .env.example. The page passes the ids
 * to the client form so it never imports the secrets.
 */
import type { BetterAuthOptions } from "better-auth"

${PROVIDERS_ANCHOR}
} satisfies NonNullable<BetterAuthOptions["socialProviders"]>

type SocialProviderId = keyof typeof socialProviders

// \`Object.keys\` of a literal object: the keys are exactly the provider ids.
const socialProviderIds = Object.keys(socialProviders) as SocialProviderId[]

export type { SocialProviderId }
export { socialProviderIds, socialProviders }
`

/** Block `g auth:provider` injects into providers.ts. */
const providerBlock = (id: string): string => `  ${id}: {
    clientId: process.env.${id.toUpperCase()}_CLIENT_ID ?? "",
    clientSecret: process.env.${id.toUpperCase()}_CLIENT_SECRET ?? "",
  },`

const providerEnv = (id: string): string[] => [
  `${id.toUpperCase()}_CLIENT_ID`,
  `${id.toUpperCase()}_CLIENT_SECRET`,
]

const authClientTemplate =
  (): string => `/** Better Auth client for client components: \`authClient.signIn\`, \`signUp\`, \`signOut\`, \`useSession\`. */
import { createAuthClient } from "better-auth/react"

const authClient = createAuthClient()

export { authClient }
`

const authRouteTemplate = (
  authImport: string
): string => `/** Better Auth API. Every \`/api/auth/*\` request lands here. */
import { toNextJsHandler } from "better-auth/next-js"
import { auth } from "${authImport}"

export const { GET, POST } = toNextJsHandler(auth)
`

interface SignInPageOptions {
  formImport: string
  providersImport: string
}

const signInPageTemplate = (
  options: SignInPageOptions
): string => `/** Sign-in page. Social buttons come from the configured providers. */
import { SignInForm } from "${options.formImport}"
import { socialProviderIds } from "${options.providersImport}"

const Page = () => (
  <main>
    <h1>Sign in</h1>
    <SignInForm providers={socialProviderIds} />
  </main>
)

export default Page
`

interface SignInFormOptions {
  clientImport: string
  providersImport: string
}

const signInFormTemplate = (options: SignInFormOptions): string => `"use client"

/**
 * Email + password sign-in with a sign-up switch and one button per social
 * provider. Redirects to \`/\` on success.
 */
import { useRouter } from "next/navigation"
import { useState } from "react"
import { authClient } from "${options.clientImport}"
import type { SocialProviderId } from "${options.providersImport}"

interface SignInFormProps {
  providers: SocialProviderId[]
}

const SignInForm = ({ providers }: SignInFormProps) => {
  const router = useRouter()
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [isPending, setIsPending] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsPending(true)
    setError(undefined)
    const data = new FormData(event.currentTarget)
    const email = String(data.get("email") ?? "")
    const password = String(data.get("password") ?? "")
    const name = String(data.get("name") ?? "")
    const result = isSignUp
      ? await authClient.signUp.email({ name, email, password })
      : await authClient.signIn.email({ email, password })
    setIsPending(false)
    if (result.error) {
      setError(result.error.message ?? "Sign-in failed")
      return
    }
    router.push("/")
    router.refresh()
  }

  return (
    <form onSubmit={submit}>
      {isSignUp ? (
        <p>
          <label htmlFor="name">Name</label>
          <input id="name" name="name" type="text" autoComplete="name" required />
        </p>
      ) : null}
      <p>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </p>
      <p>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          minLength={8}
          required
        />
      </p>
      {error === undefined ? null : <p role="alert">{error}</p>}
      <button type="submit" disabled={isPending}>
        {isSignUp ? "Create account" : "Sign in"}
      </button>
      <button type="button" onClick={() => setIsSignUp((value) => !value)}>
        {isSignUp ? "I have an account" : "Create an account"}
      </button>
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          onClick={() => authClient.signIn.social({ provider, callbackURL: "/" })}
        >
          Continue with {provider}
        </button>
      ))}
    </form>
  )
}

export { SignInForm }
`

const signInFormTestTemplate =
  (): string => `import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { SignInForm } from "./sign-in-form"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

describe("SignInForm", () => {
  it("renders the email form and one button per provider", () => {
    const html = renderToStaticMarkup(<SignInForm providers={[]} />)
    expect(html).toContain('name="email"')
    expect(html).toContain('name="password"')
    expect(html).not.toContain("Continue with")
  })
})
`

export {
  AUTH_ENV,
  AUTH_MODELS,
  authClientTemplate,
  authRouteTemplate,
  betterAuthTemplate,
  PROVIDERS_ANCHOR,
  placeholderTemplate,
  providerBlock,
  providerEnv,
  providersTemplate,
  signInFormTemplate,
  signInFormTestTemplate,
  signInPageTemplate,
}
