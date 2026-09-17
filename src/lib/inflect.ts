/**
 * Word inflection for generator names. Rule tables cover the common English
 * cases. Add an irregular here when a model name pluralises wrongly.
 */

const IRREGULAR: ReadonlyArray<readonly [string, string]> = [
  ["person", "people"],
  ["man", "men"],
  ["child", "children"],
  ["foot", "feet"],
  ["tooth", "teeth"],
  ["goose", "geese"],
  ["mouse", "mice"],
  ["ox", "oxen"],
  ["index", "indices"],
  ["matrix", "matrices"],
  ["vertex", "vertices"],
  ["criterion", "criteria"],
  ["phenomenon", "phenomena"],
  ["leaf", "leaves"],
  ["loaf", "loaves"],
  ["thief", "thieves"],
  ["half", "halves"],
  ["calf", "calves"],
  ["knife", "knives"],
  ["wife", "wives"],
  ["life", "lives"],
  ["wolf", "wolves"],
  ["shelf", "shelves"],
]

const UNCOUNTABLE = new Set([
  "equipment",
  "information",
  "rice",
  "money",
  "species",
  "series",
  "fish",
  "sheep",
  "news",
  "data",
  "metadata",
  "media",
])

const PLURAL_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/(quiz)$/i, "$1zes"],
  [/([m|l])ouse$/i, "$1ice"],
  [/(x|ch|ss|sh)$/i, "$1es"],
  [/([^aeiouy]|qu)y$/i, "$1ies"],
  [/(hive)$/i, "$1s"],
  [/(?:([^f])fe|([lr])f)$/i, "$1$2ves"],
  [/sis$/i, "ses"],
  [/([ti])um$/i, "$1a"],
  [/(buffal|tomat|potat|her)o$/i, "$1oes"],
  [/(alias|status)$/i, "$1es"],
  [/(octop|vir)us$/i, "$1i"],
  [/s$/i, "s"],
  [/$/, "s"],
]

const SINGULAR_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/(quiz)zes$/i, "$1"],
  [/(matr)ices$/i, "$1ix"],
  [/(vert|ind)ices$/i, "$1ex"],
  [/^(ox)en$/i, "$1"],
  [/(alias|status)es$/i, "$1"],
  [/(octop|vir)i$/i, "$1us"],
  [/(cris|ax|test)es$/i, "$1is"],
  [/(shoe)s$/i, "$1"],
  [/(o)es$/i, "$1"],
  [/(bus)es$/i, "$1"],
  [/([m|l])ice$/i, "$1ouse"],
  [/(x|ch|ss|sh)es$/i, "$1"],
  [/(m)ovies$/i, "$1ovie"],
  [/(s)eries$/i, "$1eries"],
  [/([^aeiouy]|qu)ies$/i, "$1y"],
  [/([lr])ves$/i, "$1f"],
  [/(tive)s$/i, "$1"],
  [/(hive)s$/i, "$1"],
  [/([^f])ves$/i, "$1fe"],
  [/(^analy)ses$/i, "$1sis"],
  [/([ti])a$/i, "$1um"],
  [/(n)ews$/i, "$1ews"],
  [/s$/i, ""],
]

const matchCase = (source: string, result: string): string => {
  if (source === source.toUpperCase()) {
    return result.toUpperCase()
  }
  if (source[0] === source[0]?.toUpperCase()) {
    return result.charAt(0).toUpperCase() + result.slice(1)
  }
  return result
}

const applyRules = (
  word: string,
  rules: ReadonlyArray<readonly [RegExp, string]>,
  irregularFrom: 0 | 1
): string => {
  const lower = word.toLowerCase()
  if (UNCOUNTABLE.has(lower)) {
    return word
  }
  for (const pair of IRREGULAR) {
    const from = pair[irregularFrom]
    const to = pair[irregularFrom === 0 ? 1 : 0]
    if (lower === from) {
      return matchCase(word, to)
    }
  }
  for (const [pattern, replacement] of rules) {
    if (pattern.test(word)) {
      return word.replace(pattern, replacement)
    }
  }
  return word
}

const plural = (word: string): string => applyRules(word, PLURAL_RULES, 0)

const singular = (word: string): string => applyRules(word, SINGULAR_RULES, 1)

/** Splits camelCase, PascalCase, kebab-case, snake_case and spaces into lowercase words. */
const words = (value: string): string[] => {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase())
}

const capitalize = (value: string): string => {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const pascalCase = (value: string): string =>
  words(value).map(capitalize).join("")

const camelCase = (value: string): string => {
  const [first, ...rest] = words(value)
  return (first ?? "") + rest.map(capitalize).join("")
}

const kebabCase = (value: string): string => words(value).join("-")

const snakeCase = (value: string): string => words(value).join("_")

const titleCase = (value: string): string =>
  words(value).map(capitalize).join(" ")

export {
  camelCase,
  kebabCase,
  pascalCase,
  plural,
  singular,
  snakeCase,
  titleCase,
  words,
}
