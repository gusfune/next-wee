/**
 * Templates for the UI generators: component, form, hook, helper, provider
 * and type. Tests render with `react-dom/server` so no testing library is
 * required in the target app.
 */

import { quoteLiteral } from "../adapters/validator.js"
import type { Attribute, ModelSpec } from "../core/adapters.js"
import { camelCase, kebabCase, pascalCase, titleCase } from "../lib/inflect.js"

/** TypeScript type for an attribute, used by `g type` and the form defaults. */
const tsType = (attribute: Attribute): string => {
  switch (attribute.type) {
    case "string":
    case "text":
    case "uuid":
    case "references":
      return "string"
    case "integer":
    case "decimal":
      return "number"
    case "boolean":
      return "boolean"
    case "datetime":
      return "Date"
    case "json":
      return "unknown"
    case "enum":
      return (attribute.values ?? []).map(quoteLiteral).join(" | ")
  }
}

interface ComponentOptions {
  name: string
  client: boolean
}

const componentTemplate = (options: ComponentOptions): string => {
  const { name, client } = options
  const lines: string[] = []
  if (client) {
    lines.push('"use client"')
  }
  lines.push(
    `/** ${name} ${client ? "client" : "server"} component. */`,
    'import type { ReactNode } from "react"',
    "",
    `interface ${name}Props {`,
    "  children?: ReactNode",
    "}",
    "",
    `const ${name} = ({ children }: ${name}Props) => (`,
    `  <div data-component="${kebabCase(name)}">{children}</div>`,
    ")",
    "",
    `export { ${name} }`,
    ""
  )
  return lines.join("\n")
}

const componentTestTemplate = (name: string): string =>
  `import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ${name} } from "./${kebabCase(name)}"

describe("${name}", () => {
  it("renders its children", () => {
    expect(renderToStaticMarkup(<${name}>hello</${name}>)).toContain("hello")
  })
})
`

interface FormOptions {
  model: ModelSpec
  /** Relative import of the model type, e.g. `../../db/schema/posts`. */
  modelImport: string
  /** Relative import of the actions file, e.g. `../../app/posts/actions`. */
  actionsImport: string
  /** Relative import of `lib/actions`, e.g. `../../lib/actions`. */
  libImport: string
}

const inputType = (attribute: Attribute): string => {
  switch (attribute.type) {
    case "integer":
    case "decimal":
      return "number"
    case "datetime":
      return "datetime-local"
    default:
      return "text"
  }
}

/** The `defaultValue`/`defaultChecked` expression for an existing record. */
const defaultExpression = (entity: string, attribute: Attribute): string => {
  const access = `${entity}?.${attribute.name}`
  switch (attribute.type) {
    case "boolean":
      return `defaultChecked={${access} ?? false}`
    case "datetime":
      return `defaultValue={${access}?.toISOString().slice(0, 16) ?? ""}`
    case "json":
      return `defaultValue={${access} === undefined ? "" : JSON.stringify(${access})}`
    default:
      return `defaultValue={${access} ?? ""}`
  }
}

const fieldLines = (entity: string, attribute: Attribute): string[] => {
  const { name } = attribute
  const label = titleCase(name)
  const required =
    attribute.optional || attribute.defaultValue !== undefined
      ? ""
      : " required"
  const control = ((): string[] => {
    switch (attribute.type) {
      case "text":
      case "json":
        return [
          `        <textarea id="${name}" name="${name}"${required} ${defaultExpression(entity, attribute)} />`,
        ]
      case "boolean":
        return [
          `        <input id="${name}" name="${name}" type="checkbox" ${defaultExpression(entity, attribute)} />`,
        ]
      case "enum":
        return [
          `        <select id="${name}" name="${name}"${required} ${defaultExpression(entity, attribute)}>`,
          '          <option value="">Select</option>',
          ...(attribute.values ?? []).map(
            (value) =>
              `          <option value=${quoteLiteral(value)}>${titleCase(value)}</option>`
          ),
          "        </select>",
        ]
      default:
        return [
          `        <input id="${name}" name="${name}" type="${inputType(attribute)}"${attribute.type === "decimal" ? ' step="any"' : ""}${required} ${defaultExpression(entity, attribute)} />`,
        ]
    }
  })()
  return [
    "      <div>",
    `        <label htmlFor="${name}">${label}</label>`,
    ...control,
    `        <FieldError messages={state.errors?.${name}} />`,
    "      </div>",
  ]
}

const formTemplate = (options: FormOptions): string => {
  const { model, modelImport, actionsImport, libImport } = options
  const entity = camelCase(model.name)
  const lines: string[] = [
    '"use client"',
    `/** Form for ${model.name}. Bound to create${model.name} and update${model.name} through useActionState. */`,
    'import { useActionState } from "react"',
    `import { create${model.name}, update${model.name} } from "${actionsImport}"`,
    `import type { ${model.name} } from "${modelImport}"`,
    `import { initialActionState } from "${libImport}"`,
    "",
    "interface FieldErrorProps {",
    "  messages?: string[] | undefined",
    "}",
    "",
    "const FieldError = ({ messages }: FieldErrorProps) =>",
    "  messages === undefined || messages.length === 0 ? null : (",
    '    <p role="alert">{messages.join(", ")}</p>',
    "  )",
    "",
    `interface ${model.name}FormProps {`,
    `  /** Existing record to edit. Omit to create. */`,
    `  ${entity}?: ${model.name}`,
    "}",
    "",
    `const ${model.name}Form = ({ ${entity} }: ${model.name}FormProps) => {`,
    `  const action = ${entity} === undefined ? create${model.name} : update${model.name}.bind(null, ${entity}.id)`,
    "  const [state, formAction, isPending] = useActionState(action, initialActionState)",
    "  return (",
    "    <form action={formAction}>",
    ...model.attributes.flatMap((attribute) => fieldLines(entity, attribute)),
    '      {state.status === "error" && state.message !== undefined ? (',
    '        <p role="alert">{state.message}</p>',
    "      ) : null}",
    '      {state.status === "success" && state.message !== undefined ? (',
    '        <p role="status">{state.message}</p>',
    "      ) : null}",
    '      <button type="submit" disabled={isPending}>',
    `        {${entity} === undefined ? "Create" : "Save"}`,
    "      </button>",
    "    </form>",
    "  )",
    "}",
    "",
    `export { ${model.name}Form }`,
    "",
  ]
  return lines.join("\n")
}

const formTestTemplate = (options: FormOptions): string => {
  const { model, actionsImport } = options
  const file = `${kebabCase(model.name)}-form`
  const first = model.attributes[0]
  return `import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { ${model.name}Form } from "./${file}"

vi.mock("${actionsImport}", () => ({
  create${model.name}: vi.fn(),
  update${model.name}: vi.fn(),
}))

describe("${model.name}Form", () => {
  it("renders the create form", () => {
    const html = renderToStaticMarkup(<${model.name}Form />)
    expect(html).toContain("<form")
${first === undefined ? "" : `    expect(html).toContain('name="${first.name}"')\n`}    expect(html).toContain("Create")
  })
})
`
}

/** Names for a hook given as `useComments` or `comments`. */
interface HookNames {
  /** `useComments` */
  hook: string
  /** `use-comments` */
  file: string
  /** `comments` */
  state: string
  /** `setComments` */
  setter: string
}

const hookNames = (name: string): HookNames => {
  const subject = pascalCase(name.replace(/^use(?=[A-Z_-]|$)/, ""))
  return {
    hook: `use${subject}`,
    file: kebabCase(`use${subject}`),
    state: camelCase(subject),
    setter: `set${subject}`,
  }
}

const hookTemplate = (name: string): string => {
  const { hook, state, setter } = hookNames(name)
  return `"use client"
/** ${hook}: owns the ${state} state. Replace the value type with what the hook holds. */
import { useCallback, useState } from "react"

const ${hook} = <T>(initialValue: T) => {
  const [${state}, ${setter}] = useState(initialValue)
  const reset = useCallback(() => ${setter}(initialValue), [initialValue])
  return { ${state}, ${setter}, reset }
}

export { ${hook} }
`
}

const hookTestTemplate = (name: string): string => {
  const { hook, state, file } = hookNames(name)
  return `import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ${hook} } from "./${file}"

const Probe = () => {
  const { ${state} } = ${hook}("initial")
  return <span>{${state}}</span>
}

describe("${hook}", () => {
  it("starts with the initial value", () => {
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>initial</span>")
  })
})
`
}

const helperTemplate = (name: string): string => {
  const fn = camelCase(name)
  return `/** ${fn}: pure helper with no framework imports. */
const ${fn} = (input: string): string => input.trim()

export { ${fn} }
`
}

const helperTestTemplate = (name: string): string => {
  const fn = camelCase(name)
  return `import { describe, expect, it } from "vitest"
import { ${fn} } from "./${kebabCase(name)}"

describe("${fn}", () => {
  it("returns the trimmed input", () => {
    expect(${fn}("  value  ")).toBe("value")
  })
})
`
}

const providerTemplate = (name: string): string => {
  const value = camelCase(name)
  return `"use client"
/** ${name}Provider holds the ${value} state; use${name} reads it. */
import type { ReactNode } from "react"
import { createContext, useContext, useMemo, useState } from "react"

/** Replace with the shape the provider owns. */
type ${name} = string

interface ${name}ContextValue {
  ${value}: ${name}
  set${name}: (${value}: ${name}) => void
}

const ${name}Context = createContext<${name}ContextValue | undefined>(undefined)

interface ${name}ProviderProps {
  children: ReactNode
  initial${name}: ${name}
}

const ${name}Provider = ({ children, initial${name} }: ${name}ProviderProps) => {
  const [${value}, set${name}] = useState(initial${name})
  const contextValue = useMemo(() => ({ ${value}, set${name} }), [${value}])
  return <${name}Context.Provider value={contextValue}>{children}</${name}Context.Provider>
}

const use${name} = (): ${name}ContextValue => {
  const context = useContext(${name}Context)
  if (context === undefined) {
    throw new Error("use${name} must be used inside ${name}Provider")
  }
  return context
}

export type { ${name} }
export { ${name}Provider, use${name} }
`
}

const providerTestTemplate = (name: string): string => {
  const value = camelCase(name)
  const file = `${kebabCase(name)}-provider`
  return `import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ${name}Provider, use${name} } from "./${file}"

const Probe = () => {
  const { ${value} } = use${name}()
  return <span>{${value}}</span>
}

describe("${name}Provider", () => {
  it("exposes the initial value through use${name}", () => {
    const html = renderToStaticMarkup(
      <${name}Provider initial${name}="light">
        <Probe />
      </${name}Provider>
    )
    expect(html).toBe("<span>light</span>")
  })

  it("use${name} throws outside the provider", () => {
    expect(() => renderToStaticMarkup(<Probe />)).toThrowError(/inside ${name}Provider/)
  })
})
`
}

interface TypeOptions {
  name: string
  attributes: Attribute[]
  /** Union members for a string literal type. */
  members: string[]
}

const typeTemplate = (options: TypeOptions): string => {
  const { name, attributes, members } = options
  if (members.length > 0) {
    return `/** ${name}: one of ${members.length} literal values. */
type ${name} = ${members.map(quoteLiteral).join(" | ")}

export type { ${name} }
`
  }
  if (attributes.length === 0) {
    return `/** ${name}: shared type not derived from a schema. Replace unknown with the shape. */
type ${name} = unknown

export type { ${name} }
`
  }
  const fields = attributes.map(
    (attribute) =>
      `  ${attribute.name}${attribute.optional ? "?" : ""}: ${tsType(attribute)}`
  )
  return `/** ${name}: shared type not derived from a schema. */
interface ${name} {
${fields.join("\n")}
}

export type { ${name} }
`
}

export {
  componentTemplate,
  componentTestTemplate,
  formTemplate,
  formTestTemplate,
  helperTemplate,
  helperTestTemplate,
  hookNames,
  hookTemplate,
  hookTestTemplate,
  providerTemplate,
  providerTestTemplate,
  tsType,
  typeTemplate,
}
