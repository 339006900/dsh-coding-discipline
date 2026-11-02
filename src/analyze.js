/**
 * Turn-level analysis over persisted session events (SPEC §2).
 *
 * Everything here is pure: events in, counters out. The dashboard, the CLI and
 * the tests all consume the same functions, so a number on the page is traceable
 * to one line of this file.
 *
 * The headline metric is structural, not textual: of the turns that edited the
 * workspace, how many also ran a verification command in that same turn. It
 * needs no language model to judge and no regex over prose, so it cannot be
 * argued with. Completion claims are kept as a secondary, auditable signal —
 * every counted claim is shown with its excerpt so a false positive is visible.
 *
 * @module dsh-coding-discipline/analyze
 */

/** Marker the prompt section opens with: its presence in the system message labels the arm. */
export const ARM_MARKER = '<coding_discipline>'

/**
 * A completion claim in the closing assistant text. Chinese-first: English
 * "done"/"fixed" appear inside code far too often to count.
 */
export const CLAIM_PATTERN =
  /(已经?(完成|修好|改好|做好|搞定|处理完)|完成了|修好了|改好了|搞定了|全部改好|应该是?(没问题|好了)|现在可以(用|跑|运行)了|should work)/i

/**
 * A command that can actually verify a change. Deliberately narrow: a bare
 * `ls` is a tool call, not evidence.
 */
export const VERIFY_PATTERN =
  /(ctest|cmake\s+--build|cmake\s+-S|msbuild|dotnet\s+(build|test)|pytest|py\.test|npm\s+(test|run)|pnpm\s+(test|run|build)|yarn\s+(test|build)|node\s+--test|npx\s+\S*(test|build|vitest|jest|tsc)|tsc\b|ruff\b|mypy\b|make\b|ninja\b|g\+\+|clang\+\+|cargo\s+(test|build|check)|go\s+(test|build|vet)|mvn\b|gradle)/i

/** Tools that execute a command, as opposed to reading or editing. */
export const EXEC_TOOL_PATTERN = /(bash|shell|exec|command|terminal|pwsh|powershell)/i

/** Tools that change the workspace. */
export const EDIT_TOOL_PATTERN = /(edit|write|patch|apply_patch|multiedit)/i

/**
 * Text blocks of an assistant message.
 * @param {any} message
 * @returns {string}
 */
export function messageText(message) {
  const content = Array.isArray(message?.content) ? message.content : []
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/**
 * Strip the places where a completion word is quoted rather than claimed:
 * fenced code blocks, inline code, and markdown table rows. A claim inside a
 * code sample is content, not a status report.
 *
 * @param {string} text
 * @returns {string}
 */
export function claimScanText(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/`[^`\n]*`/g, ' ')
    // Quoted passages are what the assistant is talking *about*, not a status
    // report of its own work.
    .replace(/「[^」]*」/g, ' ')
    .replace(/“[^”]*”/g, ' ')
    .replace(/"[^"\n]{0,120}"/g, ' ')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('|'))
    .join('\n')
}

/**
 * @param {string} text
 * @returns {string[]} matched claim phrases, unique and in order
 */
export function findClaims(text) {
  const cleaned = claimScanText(text)
  const matches = cleaned.match(new RegExp(CLAIM_PATTERN.source, 'gi'))
  return matches ? [...new Set(matches.map((item) => item.toLowerCase()))] : []
}

/**
 * @param {string} command
 * @returns {boolean}
 */
export function isVerificationCommand(command) {
  return VERIFY_PATTERN.test(String(command ?? ''))
}

/**
 * The command a tool call actually runs, when it has one.
 *
 * @param {any} data - tool/call data.
 * @returns {string}
 */
export function commandOf(data) {
  const args = String(data?.arguments ?? '')
  try {
    const parsed = JSON.parse(args)
    const value = parsed.command ?? parsed.cmd ?? parsed.script ?? parsed.input
    if (typeof value === 'string') return value
  } catch {
    // fall through to the raw arguments
  }
  return args
}

/**
 * Analyze one session's events.
 *
 * @param {Array<Record<string, any>>} events
 * @param {{ file?: string, workspace?: string }} [meta]
 * @returns {{
 *   id: string, workspace: string, cwd: string, arm: 'with' | 'without' | 'unknown',
 *   startedAt: number, turns: Array<object>, totals: object
 * }}
 */
export function analyzeSession(events, meta = {}) {
  const headerEvent = events.find((event) => event?.type === 'session') ?? {}
  const header = headerEvent.data ?? headerEvent
  /** @type {Map<number, any>} */
  const turns = new Map()
  // The arm is a property of the prompt in force when a turn starts, not of the
  // whole session: a session opened before the plugin was installed picks the
  // marker up mid-way, and only its later turns are treatment.
  let currentArm = 'unknown'
  let sawSystem = false

  /** @param {number} index */
  const turnAt = (index) => {
    const key = Number(index)
    let turn = turns.get(key)
    if (!turn) {
      turn = {
        turn: key,
        arm: currentArm,
        startedAt: 0,
        endedAt: 0,
        assistantTexts: [],
        toolCalls: 0,
        execCalls: 0,
        verifyCalls: 0,
        editCalls: 0,
        commands: [],
        verified: false,
        edited: false,
        claims: [],
        chars: 0,
        claimWithoutEvidence: false,
      }
      turns.set(key, turn)
    }
    return turn
  }

  for (const event of events) {
    const data = event?.data ?? {}
    switch (event?.type) {
      case 'system/message': {
        sawSystem = true
        const text = messageText(data.message ?? data)
        if (text.includes(ARM_MARKER)) currentArm = 'with'
        else if (text.length > 0 && currentArm === 'unknown') currentArm = 'without'
        break
      }
      case 'turn/start': {
        const turn = turnAt(data.turn)
        turn.startedAt = Number(event.time) || turn.startedAt
        break
      }
      case 'turn/end': {
        const turn = turnAt(data.turn)
        turn.endedAt = Number(event.time) || turn.endedAt
        break
      }
      case 'tool/call': {
        const turn = turnAt(data.turn)
        turn.toolCalls += 1
        const name = String(data.name ?? '')
        if (EXEC_TOOL_PATTERN.test(name)) {
          turn.execCalls += 1
          const command = commandOf(data)
          if (isVerificationCommand(command)) {
            turn.verifyCalls += 1
            turn.verified = true
            if (turn.commands.length < 4) turn.commands.push(command.replace(/\s+/g, ' ').slice(0, 140))
          }
        }
        if (EDIT_TOOL_PATTERN.test(name)) {
          turn.editCalls += 1
          turn.edited = true
        }
        break
      }
      case 'assistant/message': {
        const turn = turnAt(data.turn)
        const text = messageText(data.message)
        if (text.trim().length > 0) turn.assistantTexts.push(text)
        break
      }
      default:
        break
    }
  }

  const list = [...turns.values()].sort((a, b) => a.turn - b.turn)
  for (const turn of list) {
    if (turn.arm === 'unknown') turn.arm = currentArm
    const closing = turn.assistantTexts[turn.assistantTexts.length - 1] ?? ''
    turn.chars = closing.length
    turn.claims = findClaims(closing)
    turn.claimWithoutEvidence = turn.claims.length > 0 && !turn.verified
  }
  const armSet = new Set(list.map((turn) => turn.arm))
  const arm = armSet.has('with') ? 'with' : armSet.has('without') ? 'without' : 'unknown'

  const editTurns = list.filter((turn) => turn.edited)
  const editVerified = editTurns.filter((turn) => turn.verified)
  const claims = list.filter((turn) => turn.claims.length > 0)
  const claimsWithEvidence = claims.filter((turn) => turn.verified)

  const totals = {
    turns: list.length,
    editTurns: editTurns.length,
    editVerifiedTurns: editVerified.length,
    closureRate: editTurns.length === 0 ? null : editVerified.length / editTurns.length,
    verifyTurns: list.filter((turn) => turn.verified).length,
    claims: claims.length,
    claimsWithEvidence: claimsWithEvidence.length,
    claimsWithoutEvidence: claims.length - claimsWithEvidence.length,
    evidenceRate: claims.length === 0 ? null : claimsWithEvidence.length / claims.length,
    avgToolCalls: average(list.map((turn) => turn.toolCalls)),
    avgEditCalls: average(list.map((turn) => turn.editCalls)),
    avgChars: Math.round(average(list.map((turn) => turn.chars))),
  }

  return {
    id: String(header.id ?? meta.file ?? 'unknown'),
    workspace: String(meta.workspace ?? ''),
    cwd: String(header.cwd ?? ''),
    arm: sawSystem ? arm : 'unknown',
    startedAt: Number(header.createdAt) || Number(list[0]?.startedAt) || 0,
    turns: list,
    totals,
  }
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function average(values) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * A short excerpt centred on the matched claim, so a reviewer can see the
 * sentence that was counted instead of the start of the message.
 *
 * @param {string} text
 * @param {string} needle
 * @returns {string}
 */
export function excerptAround(text, needle) {
  const cleaned = claimScanText(text).replace(/\s+/g, ' ').trim()
  const index = needle ? cleaned.toLowerCase().indexOf(needle.toLowerCase()) : -1
  if (index < 0) return cleaned.slice(0, 140)
  const start = Math.max(0, index - 40)
  const end = Math.min(cleaned.length, index + needle.length + 90)
  return `${start > 0 ? '…' : ''}${cleaned.slice(start, end)}${end < cleaned.length ? '…' : ''}`
}
function localDay(timestamp) {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Per-day closure rate, so a change in behaviour is visible as a step in the
 * chart rather than only as one pooled number.
 *
 * @param {Array<ReturnType<typeof analyzeSession>>} sessions
 * @returns {Array<object>}
 */
function buildDaily(sessions) {
  /** @type {Map<string, any>} */
  const days = new Map()
  for (const session of sessions) {
    for (const turn of session.turns) {
      if (!turn.startedAt) continue
      const key = localDay(turn.startedAt)
      let day = days.get(key)
      if (!day) {
        day = { date: key, turns: 0, editTurns: 0, editVerified: 0, withTurns: 0, withoutTurns: 0 }
        days.set(key, day)
      }
      day.turns += 1
      if (turn.arm === 'with') day.withTurns += 1
      else if (turn.arm === 'without') day.withoutTurns += 1
      if (turn.edited) {
        day.editTurns += 1
        if (turn.verified) day.editVerified += 1
      }
    }
  }
  return [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => ({ ...day, closureRate: day.editTurns === 0 ? null : day.editVerified / day.editTurns }))
}

/**
 * Aggregate turns into the two arms plus a daily series.
 *
 * Grouping is by turn, not by session, because a session can start under one
 * prompt and continue under the other.
 *
 * @param {Array<ReturnType<typeof analyzeSession>>} sessions
 * @returns {object}
 */
export function summarize(sessions) {
  const usable = sessions.filter((session) => session.totals.turns > 0)
  /** @type {Array<any>} */
  const allTurns = []
  for (const session of usable) {
    for (const turn of session.turns) {
      if (turn.arm === 'unknown') continue
      allTurns.push({ ...turn, sessionId: session.id })
    }
  }

  /** @param {'with' | 'without'} name */
  const arm = (name) => {
    const turns = allTurns.filter((turn) => turn.arm === name)
    const editTurns = turns.filter((turn) => turn.edited)
    const editVerified = editTurns.filter((turn) => turn.verified)
    const claims = turns.filter((turn) => turn.claims.length > 0)
    const claimsWithEvidence = claims.filter((turn) => turn.verified)
    return {
      label: name,
      sessions: new Set(turns.map((turn) => turn.sessionId)).size,
      turns: turns.length,
      editTurns: editTurns.length,
      editVerifiedTurns: editVerified.length,
      closureRate: editTurns.length === 0 ? null : editVerified.length / editTurns.length,
      verifyTurns: turns.filter((turn) => turn.verified).length,
      verifyRate: turns.length === 0 ? null : turns.filter((turn) => turn.verified).length / turns.length,
      claims: claims.length,
      claimsWithEvidence: claimsWithEvidence.length,
      claimsWithoutEvidence: claims.length - claimsWithEvidence.length,
      evidenceRate: claims.length === 0 ? null : claimsWithEvidence.length / claims.length,
      avgToolCalls: average(turns.map((turn) => turn.toolCalls)),
      avgChars: Math.round(average(turns.map((turn) => turn.chars))),
    }
  }

  const gaps = allTurns
    .filter((turn) => turn.claimWithoutEvidence)
    .map((turn) => {
      const closing = turn.assistantTexts[turn.assistantTexts.length - 1] ?? ''
      return {
        session: String(turn.sessionId).slice(0, 8),
        arm: turn.arm,
        turn: turn.turn,
        at: turn.startedAt,
        claims: turn.claims,
        commands: turn.commands,
        excerpt: excerptAround(closing, turn.claims[0] ?? ''),
      }
    })

  return {
    generatedAt: Date.now(),
    arms: { with: arm('with'), without: arm('without') },
    daily: buildDaily(usable),
    gaps: gaps.slice(-40).reverse(),
    sessions: sessions.length,
    skipped: sessions.length - usable.length,
  }
}
