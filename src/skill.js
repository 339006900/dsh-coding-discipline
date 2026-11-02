/**
 * The bundled `coding-discipline` skill (SPEC §2).
 *
 * The skill is the long form of the prompt section: checklists, verification
 * recipes per toolchain, and the debugging ladder. It is registered through the
 * skill registry, so the model sees only its one-line description until a task
 * is large enough to load it — the prompt section stays small.
 *
 * The frontmatter in SKILL.md is the single source of the routing description;
 * a copy in code would drift unnoticed.
 *
 * @module dsh-coding-discipline/skill
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Kebab-case skill name the model loads. */
export const SKILL_NAME = 'coding-discipline'

/** Provider label; must not be the reserved `runtime`. */
export const PROVIDER_NAME = 'dsh-coding-discipline'

/**
 * Catalog rank. Bundled skills sit above filesystem skills of the same name so
 * a stray local copy cannot shadow the protocol the user installed on purpose.
 */
const BUNDLED_SKILL_RANK = 500

/** Model- and user-invocable: the model may load it, the user may too. */
const BUNDLED_SKILL_INVOCATION = Object.freeze({ modelInvocable: true, userInvocable: true })

/** Directory of this module (`src/`), used to locate the package root. */
function moduleDirectory() {
  return dirname(fileURLToPath(new URL(import.meta.url)))
}

/**
 * Locate SKILL.md from a module directory. Both the source layout (`src/`) and
 * a flattened build (`lib/`) resolve to the package root.
 *
 * @param {string} [moduleDir]
 * @returns {string} absolute path
 */
export function resolveSkillPath(moduleDir = moduleDirectory()) {
  return resolve(moduleDir, '..', 'SKILL.md')
}

/**
 * Split `---` frontmatter from the instruction body.
 *
 * Only the flat `key: value` subset is supported — that is all a skill header
 * needs, and a strict parser fails loudly instead of guessing.
 *
 * @param {string} raw - file contents.
 * @returns {{ frontmatter: Record<string, string>, body: string }}
 */
export function parseFrontmatter(raw) {
  const text = String(raw ?? '')
  if (!text.startsWith('---\n')) throw new Error('SKILL.md must start with a --- frontmatter block')
  const end = text.indexOf('\n---\n', 4)
  if (end < 0) throw new Error('SKILL.md frontmatter is not closed by ---')
  /** @type {Record<string, string>} */
  const frontmatter = {}
  for (const line of text.slice(4, end).split('\n')) {
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const value = match[2].trim().replace(/^['"]|['"]$/g, '')
    frontmatter[match[1]] = value
  }
  return { frontmatter, body: text.slice(end + 5) }
}

/**
 * Build the provider the skill registry calls for listing and loading.
 *
 * @param {string} [moduleDir] - directory of the calling module; injectable for tests.
 * @returns {{ name: string, list: () => Promise<object[]>, get: () => Promise<object> }}
 */
export function createSkillProvider(moduleDir = moduleDirectory()) {
  const path = resolveSkillPath(moduleDir)
  const raw = readFileSync(path, 'utf8')
  const { frontmatter, body } = parseFrontmatter(raw)
  const description = frontmatter.description
  if (!description) throw new Error('SKILL.md frontmatter has no description')

  const summary = {
    name: SKILL_NAME,
    description,
    invocation: { ...BUNDLED_SKILL_INVOCATION },
    source: 'bundled',
    provider: PROVIDER_NAME,
    path,
    resourceBase: { kind: 'directory', path: dirname(path) },
    rank: BUNDLED_SKILL_RANK,
    locator: path,
  }

  return {
    name: PROVIDER_NAME,
    list: () => Promise.resolve([{ ...summary }]),
    get: () => Promise.resolve({ ...summary, content: body }),
  }
}
