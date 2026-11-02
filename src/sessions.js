/**
 * Reading persisted session logs (SPEC §1).
 *
 * DSH stores one zstd-framed JSONL per session at
 * `<root>/<sessionId>/session.v4.jsonl.zstd`. The file is a sequence of
 * independent zstd frames, so a single `zstdDecompressSync(buffer)` returns only
 * the first frame's bytes; every frame is decoded and concatenated here.
 *
 * @module dsh-coding-discipline/sessions
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'

/** zstd frame magic number. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** File name the harness uses for the current session format. */
export const SESSION_FILE = 'session.v4.jsonl.zstd'

/**
 * Decode every zstd frame in a buffer.
 *
 * @param {Buffer} buffer - raw file bytes.
 * @returns {string} concatenated UTF-8 payload.
 */
export function decodeZstdFrames(buffer) {
  /** @type {number[]} */
  const offsets = []
  let cursor = 0
  while ((cursor = buffer.indexOf(ZSTD_MAGIC, cursor)) !== -1) {
    offsets.push(cursor)
    cursor += ZSTD_MAGIC.length
  }
  if (offsets.length === 0) return zstdDecompressSync(buffer).toString('utf8')

  let text = ''
  for (let index = 0; index < offsets.length; index++) {
    const end = index + 1 < offsets.length ? offsets[index + 1] : buffer.length
    try {
      text += zstdDecompressSync(buffer.subarray(offsets[index], end)).toString('utf8')
    } catch {
      // A torn tail frame is possible while a session is being written; the
      // frames before it are still valid, which is what matters.
    }
  }
  return text
}

/**
 * Parse one session file into events. Malformed lines are skipped: a session
 * being written right now ends mid-line.
 *
 * @param {string} file - absolute path.
 * @returns {Array<Record<string, any>>}
 */
export function readSessionEvents(file) {
  const text = decodeZstdFrames(readFileSync(file))
  /** @type {Array<Record<string, any>>} */
  const events = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // skip a torn line
    }
  }
  return events
}

/**
 * Default session root when the caller has no explicit choice.
 * @returns {string}
 */
export function defaultSessionsRoot() {
  return join(homedir(), '.dsh', 'sessions')
}

/**
 * Discover session files below a root.
 *
 * Accepts either `~/.dsh/sessions` (one directory per workspace, then one per
 * session) or a single workspace directory.
 *
 * @param {string} root
 * @returns {Array<{ id: string, file: string, mtime: number }>} newest first
 */
export function listSessionFiles(root) {
  /** @type {Array<{ id: string, file: string, mtime: number }>} */
  const found = []
  if (!existsSync(root)) return found

  const direct = join(root, SESSION_FILE)
  if (existsSync(direct)) {
    found.push({ id: root.split(/[\\/]/).filter(Boolean).pop() ?? '', file: direct, mtime: statSync(direct).mtimeMs })
    return found
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const nested = join(root, entry.name, SESSION_FILE)
    if (existsSync(nested)) {
      found.push({ id: entry.name, file: nested, mtime: statSync(nested).mtimeMs })
      continue
    }
    // One more level: workspace directory containing session directories.
    for (const inner of readdirSync(join(root, entry.name), { withFileTypes: true })) {
      if (!inner.isDirectory()) continue
      const file = join(root, entry.name, inner.name, SESSION_FILE)
      if (existsSync(file)) {
        found.push({
          id: inner.name,
          workspace: entry.name,
          file,
          mtime: statSync(file).mtimeMs,
        })
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime)
}
