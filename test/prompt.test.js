/**
 * Tests for the discipline section, the settings normalizer, and the bundled
 * skill. Run with `node --test`.
 *
 * These run without DSH: a fake context records what the plugin registers, so a
 * broken registration is caught here instead of on the next host boot.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply, name as pluginName, inject } from '../src/index.js'
import {
  DEFAULT_ORDER,
  SECTION_NAME,
  buildSectionText,
  normalizeSettings,
} from '../src/prompt.js'
import { SKILL_NAME, createSkillProvider, parseFrontmatter } from '../src/skill.js'

test('plugin identity and hard dependency', () => {
  assert.equal(pluginName, 'dsh-coding-discipline')
  assert.deepEqual(inject, ['systemPrompt'])
})

test('section text is a closed block with every rule', () => {
  const text = buildSectionText()
  assert.ok(text.startsWith('<coding_discipline>'))
  assert.ok(text.trimEnd().endsWith('</coding_discipline>'))
  for (const phrase of ['LEDGER.', 'PROOF BEFORE DONE.', 'SMALLEST DIFF.', 'HYPOTHESIS', 'NO INVENTED APIS.', 'FINISH THE MIGRATION.']) {
    assert.ok(text.includes(phrase), `missing rule: ${phrase}`)
  }
  // Rules are numbered continuously.
  assert.ok(text.includes('\n1. LEDGER.'))
  assert.ok(text.includes('\n9. CLOSING SHAPE.'))
})

test('dropRules removes exactly the named rules and renumbers', () => {
  const text = buildSectionText({ dropRules: ['closing-shape', 'no-speculative-code'] })
  assert.ok(!text.includes('CLOSING SHAPE.'))
  assert.ok(!text.includes('NO SPECULATIVE CODE.'))
  assert.ok(text.includes('\n7. EVIDENCE OVER AGREEING.'))
  assert.ok(!text.includes('\n8. '))
})

test('compact keeps the four expensive failures', () => {
  const text = buildSectionText({ compact: true })
  assert.ok(text.includes('PROOF BEFORE DONE.'))
  assert.ok(text.includes('LEDGER.'))
  assert.ok(text.includes('SMALLEST DIFF.'))
  assert.ok(text.includes('HYPOTHESIS'))
  assert.ok(!text.includes('NO SPECULATIVE CODE.'))
})

test('extraRules are appended after the built-in rules and numbers continue', () => {
  const text = buildSectionText({ extraRules: 'Use tabs, not spaces.\n1. Mention the tradeoff.' })
  assert.ok(text.includes('\n10. Use tabs, not spaces.'))
  assert.ok(text.includes('\n11. Mention the tradeoff.'))
  assert.ok(text.indexOf('Use tabs') < text.indexOf('</coding_discipline>'))
})

test('settings normalize defaults and reject a broken order', () => {
  assert.equal(normalizeSettings().order, DEFAULT_ORDER)
  assert.equal(normalizeSettings({ order: 'not-a-number' }).order, DEFAULT_ORDER)
  assert.equal(normalizeSettings({ order: '9200' }).order, 9200)
  assert.equal(normalizeSettings({ enabled: false }).enabled, false)
  assert.equal(normalizeSettings({ promptSection: false }).promptSection, false)
  assert.deepEqual(normalizeSettings({ dropRules: 'a, b' }).dropRules, ['a', 'b'])
  assert.equal(normalizeSettings(null).enabled, true)
})

test('frontmatter parsing rejects a missing header', () => {
  assert.throws(() => parseFrontmatter('no header'), /must start with a --- frontmatter/)
  const parsed = parseFrontmatter('---\nname: x\ndescription: "uses it"\n---\nbody\n')
  assert.equal(parsed.frontmatter.description, 'uses it')
  assert.equal(parsed.body, 'body\n')
})

test('bundled skill lists one loadable entry read from SKILL.md', async () => {
  const provider = createSkillProvider()
  const rows = await provider.list()
  assert.equal(rows.length, 1)
  const [row] = rows
  assert.equal(row.name, SKILL_NAME)
  assert.match(row.name, /^[a-z0-9]+(-[a-z0-9]+)*$/)
  assert.ok(row.description.length > 20)
  assert.equal(row.source, 'bundled')
  assert.deepEqual(row.invocation, { modelInvocable: true, userInvocable: true })

  const loaded = await provider.get()
  assert.equal(loaded.name, SKILL_NAME)
  assert.ok(loaded.content.includes('## 0. The completion contract'))
  assert.ok(!loaded.content.startsWith('---'), 'frontmatter must not leak into the body')
})

/** Minimal cordis stand-in that records registrations. */
function createFakeContext() {
  /** @type {{ sections: object[], providers: Array<() => object> }} */
  const calls = { sections: [], providers: [] }
  const ctx = {
    systemPrompt: { section: (value) => calls.sections.push(value) },
    inject: (deps, callback) => callback({ skills: { registerProvider: (factory) => calls.providers.push(factory) } }),
  }
  return { ctx, calls }
}

test('apply registers one section and one skill provider', () => {
  const { ctx, calls } = createFakeContext()
  apply(ctx, {})
  assert.equal(calls.sections.length, 1)
  assert.equal(calls.sections[0].name, SECTION_NAME)
  assert.equal(calls.sections[0].order, DEFAULT_ORDER)
  assert.equal(calls.sections[0].interpolate, false)
  assert.ok(calls.sections[0].text.includes('PROOF BEFORE DONE.'))
  assert.equal(calls.providers.length, 1)
})

test('apply honours config and degrades when a service is missing', () => {
  const off = createFakeContext()
  apply(off.ctx, { enabled: false })
  assert.equal(off.calls.sections.length, 0)
  assert.equal(off.calls.providers.length, 0)

  const noSkills = { systemPrompt: { section: (value) => (noSkills.section = value) }, inject: () => {} }
  apply(noSkills, {})
  assert.equal(noSkills.section.order, DEFAULT_ORDER)

  const noPrompt = { inject: () => {} }
  assert.doesNotThrow(() => apply(noPrompt, {}))
})
