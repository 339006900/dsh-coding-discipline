/**
 * The always-on prompt section: the behavioral rules this plugin contributes to
 * every model step (SPEC §1).
 *
 * The text is deliberately small — it repeats on every request and is paid for
 * on every turn — so each rule names one failure mode and one concrete action.
 * Everything longer lives in SKILL.md, which is loaded only when a task is big
 * enough to deserve it.
 *
 * @module dsh-coding-discipline/prompt
 */

/** Section name in the system-prompt registry; also the plugin's identity string. */
export const SECTION_NAME = 'coding-discipline'

/**
 * Default placement. First-party guidance sits below this; runtime context
 * (cwd, date, platform) is emitted at 10000+, so 9500 keeps these rules at the
 * end of the instruction block and before the environment facts.
 */
export const DEFAULT_ORDER = 9500

/**
 * One line per rule, kept as an array so tests can assert on them individually
 * and a deployment can drop a rule by name through `dropRules`.
 */
export const RULES = [
  {
    id: 'ledger',
    text:
      'LEDGER. Before the first edit, restate the hard constraints as a short bullet list: what must not change (files, public APIs, dependencies, behavior), how the change is verified (build/test command), and the target platform. Re-read that list before each edit batch and before you finish. If a later instruction conflicts with one, raise the conflict instead of silently dropping the constraint.',
  },
  {
    id: 'proof',
    text:
      'PROOF BEFORE DONE. "已完成", "修好了", "搞定", "应该没问题" are claims that need evidence from this turn: the exact command you ran and its result. If you cannot run it (missing toolchain, GUI-only platform, no test suite), say precisely which check did not run and what is still unverified. An unverified change must never read as verified.',
  },
  {
    id: 'smallest-diff',
    text:
      'SMALLEST DIFF. Change only what the request requires. No reformatting, renaming, import reordering, or comment polishing on lines nobody asked about. A 3-line patch beats a rewrite; if a whole-file rewrite is genuinely necessary, say why in one sentence before writing it.',
  },
  {
    id: 'hypothesis',
    text:
      'HYPOTHESIS, THEN EXPERIMENT. For a bug, first state the suspected root cause and the single observation that would confirm or refute it (a log line, a minimal reproduction, the exact compiler/linker command, a symbol or ABI check). Run that observation, then edit. Two speculative edits in a row without new evidence means stop and instrument instead of guessing again.',
  },
  {
    id: 'no-invented-apis',
    text:
      'NO INVENTED APIS. A flag, method signature, environment variable, or config key you have not read this turn is an assumption, not a fact. Check --help, the source, or the docs first; if that is impossible, label it as an assumption and name the check that would settle it.',
  },
  {
    id: 'finish-migration',
    text:
      'FINISH THE MIGRATION. In a refactor, search for the old symbol and migrate every call site before declaring completion. One call site left on the old path is a defect, not a detail — say so if you deliberately leave one.',
  },
  {
    id: 'evidence-over-agreeing',
    text:
      'EVIDENCE OVER AGREEING. When the user says something looks wrong, verify before editing. Change working code only when the evidence demands it, and answer with what you observed rather than with agreement.',
  },
  {
    id: 'no-speculative-code',
    text:
      'NO SPECULATIVE CODE. No abstraction for a single caller, no parameter nobody passes, no defensive branch for a state that cannot occur, no comment that restates the line below it. Match the style already in the file.',
  },
  {
    id: 'closing-shape',
    text:
      'CLOSING SHAPE. Report what changed (paths and the few key lines), the command you ran and its result, and what remains unverified or unfinished. Skip the celebration and the line-by-line diff recap.',
  },
]

/** Everything between the opening and closing tag, before any deployment additions. */
const HEADER =
  'Hard rules for every task that writes, edits, or debugs code. They override default habits. They exist because these are the failure modes that cost the most in long sessions: claiming success without proof, forgetting a stated constraint, drifting into a whole-file rewrite, and patching symptoms instead of the cause.'

/** Trailing line; states precedence so a conflicting user request is not read as permission to skip the rules. */
const FOOTER =
  'A user instruction can narrow these rules (for example "just show me the patch"), but it never licenses a false completion claim.'

/**
 * Assemble the section text.
 *
 * @param {object} [options]
 * @param {string} [options.extraRules] - deployment-specific lines, appended after the built-in rules.
 * @param {string[]} [options.dropRules] - rule ids to omit (e.g. "closing-shape" for a terse deployment).
 * @param {boolean} [options.compact] - keep only the four rules that catch the expensive failures.
 * @returns {string} section text, ready for `ctx.systemPrompt.section`.
 */
export function buildSectionText(options = {}) {
  const { extraRules = '', dropRules = [], compact = false } = options
  const dropped = new Set(normalizeDropRules(dropRules))
  const kept = RULES.filter((rule) => !dropped.has(rule.id))
  const selected = compact ? kept.filter((rule) => COMPACT_IDS.has(rule.id)) : kept

  const parts = ['<coding_discipline>', HEADER, '']
  selected.forEach((rule, index) => {
    parts.push(`${index + 1}. ${rule.text}`)
  })

  const extra = String(extraRules ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (extra.length > 0) {
    parts.push('')
    extra.forEach((line, index) => parts.push(`${selected.length + index + 1}. ${line.replace(/^\d+[.)]\s*/, '')}`))
  }

  parts.push('', FOOTER, '</coding_discipline>')
  return parts.join('\n')
}

/** The four rules a `compact` deployment keeps: the expensive, silent failures. */
const COMPACT_IDS = new Set(['proof', 'ledger', 'smallest-diff', 'hypothesis'])

/** @param {unknown} value */
function normalizeDropRules(value) {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === 'string' && value.trim().length > 0) return value.split(',').map((item) => item.trim())
  return []
}

/** Plugin settings after defaults and light validation. */
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  order: DEFAULT_ORDER,
  promptSection: true,
  skill: true,
  compact: false,
  extraRules: '',
  dropRules: [],
  dashboard: true,
  sessionsRoot: '',
})

/**
 * Merge deployment config over the defaults. Unknown keys are dropped and a
 * non-finite `order` falls back to the default instead of failing prompt
 * assembly on the first turn.
 *
 * @param {Record<string, unknown>} [config]
 * @returns {{ enabled: boolean, order: number, promptSection: boolean, skill: boolean,
 *   compact: boolean, extraRules: string, dropRules: string[] }}
 */
export function normalizeSettings(config = {}) {
  const input = config && typeof config === 'object' ? config : {}
  const order = Number(input.order)
  return {
    enabled: input.enabled !== false,
    order: Number.isFinite(order) ? order : DEFAULT_ORDER,
    promptSection: input.promptSection !== false,
    skill: input.skill !== false,
    compact: input.compact === true,
    extraRules: typeof input.extraRules === 'string' ? input.extraRules : '',
    dropRules: normalizeDropRules(input.dropRules),
    dashboard: input.dashboard !== false,
    sessionsRoot: typeof input.sessionsRoot === 'string' ? input.sessionsRoot : '',
  }
}
