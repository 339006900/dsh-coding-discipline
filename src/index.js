/**
 * Host wiring for dsh-coding-discipline (SPEC §3).
 *
 * Two contributions, both optional at runtime so a composition missing a
 * service degrades to "less guidance" instead of "plugin does not load":
 *
 * 1. a system-prompt section carrying the always-on rules (`inject` covers the
 *    only hard dependency, `systemPrompt`);
 * 2. a bundled `coding-discipline` skill registered through the skill registry.
 *
 * `skills` is not in `inject` on purpose: a composition without a skill
 * registry must still get the prompt section. The service is awaited with
 * `ctx.inject(['skills'], ...)`, which starts the registration when (and only
 * when) the registry exists.
 *
 * @module dsh-coding-discipline
 */

import { buildSectionText, normalizeSettings, SECTION_NAME } from './prompt.js'
import { createSkillProvider } from './skill.js'
import { createDashboardHandler, createDashboardPage, ROUTE_PATH } from './route.js'

/** Cordis plugin name. */
export const name = 'dsh-coding-discipline'

/** Required service. A composition without a system prompt has nowhere to put these rules. */
export const inject = ['systemPrompt']

/** Defaults, re-exported so a deployment and the tests read one source. */
export { DEFAULT_SETTINGS as DEFAULTS } from './prompt.js'

/**
 * Emit a load-time warning without assuming a logger service exists.
 *
 * @param {object} ctx - cordis context.
 * @param {string} message - what went wrong.
 * @param {unknown} [cause] - the original error, when there is one.
 */
function warn(ctx, message, cause) {
  const detail = cause instanceof Error ? `${message}: ${cause.message}` : message
  try {
    const logger = /** @type {{ warn?: (text: string) => void }} */ (
      /** @type {Record<string, unknown>} */ (ctx)?.logger
    )
    if (typeof logger?.warn === 'function') {
      logger.warn(`[dsh-coding-discipline] ${detail}`)
      return
    }
  } catch {
    // A logger that throws is not worth failing the plugin over.
  }
  // eslint-disable-next-line no-console
  console.warn(`[dsh-coding-discipline] ${detail}`)
}

/**
 * Register the discipline section and the bundled skill.
 *
 * @param {object} ctx - cordis context.
 * @param {Record<string, unknown>} [config] - deployment configuration from the profile patch.
 */
export function apply(ctx, config = {}) {
  const settings = normalizeSettings(config)
  if (!settings.enabled) return

  if (settings.promptSection) {
    const prompt = /** @type {{ section?: (value: object) => unknown } | undefined} */ (ctx?.systemPrompt)
    if (typeof prompt?.section !== 'function') {
      warn(ctx, 'systemPrompt.section is unavailable; the discipline section was not registered')
    } else {
      prompt.section({
        name: SECTION_NAME,
        order: settings.order,
        // The text is fixed; braces inside it must stay literal instead of
        // being read as prompt-variable references.
        interpolate: false,
        text: buildSectionText(settings),
      })
    }
  }

  if (settings.skill) {
    let provider
    try {
      provider = createSkillProvider()
    } catch (error) {
      warn(ctx, 'the bundled coding-discipline skill could not be read', error)
      provider = null
    }
    if (provider) {
      ctx.inject(['skills'], (scope) => {
        scope.skills.registerProvider(() => provider)
      })
    }
  }

  if (settings.dashboard) {
    registerDashboard(ctx, settings)
  }
}

/**
 * Serve the dashboard from the host web server, when the composition has one.
 *
 * `webServer` is awaited rather than injected: a headless composition has no
 * HTTP surface and must still get the prompt section.
 *
 * @param {object} ctx - cordis context.
 * @param {{ sessionsRoot?: string }} settings - normalized configuration.
 */
export function registerDashboard(ctx, settings) {
  const render = createDashboardPage({ root: settings.sessionsRoot || undefined })
  ctx.inject(['webServer'], (scope) => {
    let server
    try {
      const get = /** @type {{ get?: (name: string) => unknown }} */ (scope).get
      server = typeof get === 'function' ? get.call(scope, 'webServer') : null
      if (!server) {
        const reflect = /** @type {{ reflect?: { get?: (name: string) => unknown } }} */ (scope).reflect
        server = typeof reflect?.get === 'function' ? reflect.get.call(reflect, 'webServer') : null
      }
    } catch {
      server = null
    }
    const register = /** @type {{ register?: (route: object) => () => unknown } | null} */ (server)?.register
    if (typeof register !== 'function') {
      // A headless composition has no HTTP surface; that is a normal deployment,
      // not a misconfiguration, so it stays quiet.
      return
    }
    const handler = createDashboardHandler({ render, warn: (message) => warn(ctx, message) })
    const install = () => register.call(server, { kind: 'prefix', path: ROUTE_PATH, handler })
    if (typeof scope.effect === 'function') {
      scope.effect(install, 'dsh-coding-discipline: dashboard route')
    } else {
      install()
    }
  })
}
