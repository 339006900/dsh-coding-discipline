#!/usr/bin/env node
/**
 * Generate the discipline dashboard from persisted session logs.
 *
 * Usage:
 *   node scripts/dashboard.mjs [--root <dir>] [--out <file>]
 *
 * The page is written to `~/.dsh/plugin-data/dsh-coding-discipline/dashboard.html`
 * by default, and the summary is printed as JSON so a terminal-only user gets
 * the same numbers without opening a browser.
 *
 * @module dsh-coding-discipline/scripts/dashboard
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { analyzeSession, summarize } from '../src/analyze.js'
import { renderDashboard } from '../src/report.js'
import { defaultSessionsRoot, listSessionFiles, readSessionEvents } from '../src/sessions.js'

/**
 * Read `--name value` pairs.
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const args = {}
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      args[key] = 'true'
      continue
    }
    args[key] = value
    index += 1
  }
  return args
}

/**
 * @param {Record<string, string>} args
 * @returns {number} process exit code
 */
export function main(args = parseArgs(process.argv.slice(2))) {
  const root = args.root ?? defaultSessionsRoot()
  const files = listSessionFiles(root)
  if (files.length === 0) {
    console.error(`没有找到会话日志：${root}`)
    return 1
  }

  const sessions = files.map((entry) => analyzeSession(readSessionEvents(entry.file), {
    file: entry.file,
    workspace: entry.workspace,
  }))
  const summary = summarize(sessions)

  const out = args.out ?? join(homedir(), '.dsh', 'plugin-data', 'dsh-coding-discipline', 'dashboard.html')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, renderDashboard(summary, { source: root, now: Date.now() }), 'utf8')

  const { with: withArm, without: withoutArm } = summary.arms
  console.log(JSON.stringify({
    sessions: summary.sessions,
    skipped: summary.skipped,
    baseline: {
      editTurns: withoutArm.editTurns,
      closureRate: withoutArm.closureRate,
      claimsWithoutEvidence: withoutArm.claimsWithoutEvidence,
      avgToolCalls: Number(withoutArm.avgToolCalls.toFixed(2)),
      avgChars: withoutArm.avgChars,
    },
    treatment: {
      editTurns: withArm.editTurns,
      closureRate: withArm.closureRate,
      claimsWithoutEvidence: withArm.claimsWithoutEvidence,
    },
    daily: summary.daily.map((day) => ({ date: day.date, edits: day.editTurns, rate: day.closureRate })),
    page: out,
  }, null, 2))
  return 0
}

const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/scripts/dashboard.mjs')
if (invokedDirectly) {
  process.exitCode = main()
}
