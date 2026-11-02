/**
 * The dashboard route (SPEC §4).
 *
 * The page is generated from the session logs on demand and cached briefly: a
 * reload after a few turns shows new data, and a flapping refresh does not
 * re-decode every log each time.
 *
 * @module dsh-coding-discipline/route
 */

import { analyzeSession, summarize } from './analyze.js'
import { renderDashboard } from './report.js'
import { defaultSessionsRoot, listSessionFiles, readSessionEvents } from './sessions.js'

/** Path the page is served under, relative to the host web server. */
export const ROUTE_PATH = '/coding-discipline'

/**
 * @param {{ root?: string, ttlMs?: number, now?: () => number }} [options]
 * @returns {() => string} renders the current page
 */
export function createDashboardPage(options = {}) {
  const root = options.root ?? defaultSessionsRoot()
  const ttlMs = options.ttlMs ?? 30_000
  const now = options.now ?? Date.now
  /** @type {{ at: number, html: string } | null} */
  let cache = null

  return function render() {
    const at = now()
    if (cache && at - cache.at < ttlMs) return cache.html
    const files = listSessionFiles(root)
    const sessions = files.map((entry) => analyzeSession(readSessionEvents(entry.file), {
      file: entry.file,
      workspace: entry.workspace,
    }))
    const html = renderDashboard(summarize(sessions), { source: root, now: at })
    cache = { at, html }
    return html
  }
}

/**
 * Node-style request handler for the host web server.
 *
 * @param {{ render: () => string, warn?: (message: string) => void }} deps
 * @returns {(req: any, res: any) => Promise<void>}
 */
export function createDashboardHandler({ render, warn }) {
  return async function handler(req, res) {
    if (req?.method !== 'GET' && req?.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    try {
      const html = render()
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      if (req.method === 'HEAD') res.end()
      else res.end(html)
    } catch (error) {
      warn?.(`dashboard render failed: ${error instanceof Error ? error.message : String(error)}`)
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dashboard render failed; see the host log')
    }
  }
}
