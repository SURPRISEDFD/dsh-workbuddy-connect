/**
 * Compatibility checks for the DeepSeek Harness v0.2.2-rc.1 adaptation.
 *
 * These assert the connector's *declared and hand-built* host contract, so
 * they run without a DSH profile or any @deepseek-ai/* package installed.
 * The behavioural regression suite stays in smoke.mjs.
 *
 * Run with: node test/compat-0.2.2-rc.1.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  HOST_CONTRACT,
  REQUEST_IMAGE_BUDGETS,
  WORKBUDDY_DEFAULT_CONTEXT_WINDOW,
  WORKBUDDY_DEFAULT_MAX_TOKENS,
  buildWorkBuddyProfile,
  capacityOf,
  prepareWorkBuddyHeaders,
} from '../lib/compat.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const manifest = JSON.parse(read('package.json'))

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (error) {
    console.error(`FAIL  ${name}\n      ${error.message}`)
    process.exitCode = 1
  }
}

console.log('manifest: runtime requirements')
check('engines.dsh accepts 0.2.2-rc.1 and rejects 0.2.1', () => {
  // Verified with semver 7: ^0.2.2-rc.1 satisfies 0.2.2-rc.1, 0.2.2-rc.2
  // and 0.2.2 final; rejects 0.2.1-rc.5 and 0.3.0.
  assert.equal(manifest.engines.dsh, '^0.2.2-rc.1')
})
check('engines.node matches the host minimum 24.9', () => {
  assert.equal(manifest.engines.node, '>=24.9.0')
})
check('all DSH peers are pinned to the 0.2.2 line', () => {
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-llm'], '^0.2.2-rc.1')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-llm-pi-ai'], '^0.2.2-rc.1')
})
check('pi-ai peer follows the host upgrade to 1.3.0', () => {
  assert.equal(manifest.peerDependencies['@earendil-works/pi-ai'], '^1.3.0')
})
check('manifest format version 1 is declared', () => {
  assert.equal(manifest.dsh.manifestVersion, 1)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
})
check('the client half and locale files are exported', () => {
  assert.equal(manifest.exports['./client'].default, './client.js')
  assert.ok(manifest.exports['./locale/*.json'])
})
check('npm test runs both suites', () => {
  assert.equal(manifest.scripts.test, 'node test/smoke.mjs && node test/compat-0.2.2-rc.1.mjs')
})

console.log('host contract')
check('the recorded contract names the exact host generation', () => {
  assert.equal(HOST_CONTRACT.dsh, '0.2.2-rc.1')
  assert.equal(HOST_CONTRACT.cordis, '4.1.0')
  assert.equal(HOST_CONTRACT.loader, '1.1.0')
  assert.equal(HOST_CONTRACT.piAi, '1.3.0')
})
check('bundle patch rows carry an explicit id for Loader 1.1.0', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /- insert:/)
  assert.match(patch, /id: llm-workbuddy/)
  assert.match(patch, /name: dsh-workbuddy-connect/)
})

console.log('pi-ai profile (v0.2.2-rc.1 fields)')
const profile = buildWorkBuddyProfile({
  key: 'workbuddy',
  displayName: 'WorkBuddy',
  piProvider: { id: 'workbuddy', getModels: () => [] },
  streamIdleTimeoutMs: 300_000,
  retryPolicy: { retries: 5 },
  reasoning: 'high',
})
check('the two new image-count bounds are present', () => {
  assert.equal(profile.maxRequestImages, REQUEST_IMAGE_BUDGETS.maxRequestImages)
  assert.equal(profile.imageOffloadCountQuantum, REQUEST_IMAGE_BUDGETS.imageOffloadCountQuantum)
  assert.ok(profile.maxRequestImages >= profile.imageOffloadCountQuantum)
})
check('the byte / pixel budgets survived the move to compat.js', () => {
  assert.equal(profile.maxRequestImageBytes, 20_971_520)
  assert.equal(profile.requestImagePixelBudget, 4_194_304)
  assert.equal(profile.requestImageMaxBytes, 1_048_576)
})
check('explicit capacity defaults beat the host 1M/128K fallback', () => {
  assert.equal(profile.defaultContextWindow, WORKBUDDY_DEFAULT_CONTEXT_WINDOW)
  assert.equal(profile.defaultMaxTokens, WORKBUDDY_DEFAULT_MAX_TOKENS)
  assert.ok(profile.defaultContextWindow < 1_000_000)
  assert.ok(profile.defaultMaxTokens < 128_000)
})
check('the pre-existing required profile fields are intact', () => {
  assert.equal(profile.provider, 'workbuddy')
  assert.equal(profile.reasoning, 'high')
  assert.equal(profile.streamIdleTimeoutMs, 300_000)
  assert.deepEqual(profile.retryPolicy, { retries: 5 })
  assert.ok(profile.configuredMaxTokens instanceof Map)
  assert.ok(profile.modelErrors instanceof Map)
  assert.equal(profile.piProvider.id, 'workbuddy')
})
check('each profile gets its own maps (no shared mutable state)', () => {
  const other = buildWorkBuddyProfile({
    key: 'workbuddy-global', displayName: 'WorkBuddy',
    piProvider: { id: 'workbuddy-global' }, streamIdleTimeoutMs: 1,
    retryPolicy: {}, reasoning: 'high',
  })
  other.modelErrors.set('x', 'boom')
  assert.equal(profile.modelErrors.size, 0)
})

console.log('model descriptor capacity')
check('declared capacities pass through unchanged', () => {
  assert.deepEqual(capacityOf({ contextWindow: 100_000, maxTokens: 64_000 }), {
    contextWindow: 100_000, maxTokens: 64_000,
  })
})
check('a row without capacities does not inherit 1M/128K', () => {
  const capacity = capacityOf({ id: 'hy3' })
  assert.equal(capacity.contextWindow, WORKBUDDY_DEFAULT_CONTEXT_WINDOW)
  assert.equal(capacity.maxTokens, WORKBUDDY_DEFAULT_MAX_TOKENS)
})
check('zero, negative, NaN and string capacities are refused', () => {
  for (const bad of [0, -1, Number.NaN, '100000', undefined, null]) {
    assert.equal(capacityOf({ contextWindow: bad, maxTokens: bad }).contextWindow, WORKBUDDY_DEFAULT_CONTEXT_WINDOW)
  }
})

console.log('dynamic request headers (new prepareHeaders hook)')
check('authorization is stripped so the shim bearer survives', () => {
  const headers = new Headers({ authorization: 'Bearer attacker', 'x-keep': 'yes' })
  const out = prepareWorkBuddyHeaders({ provider: 'workbuddy', model: 'hy3' }, headers)
  assert.equal(out, headers)
  assert.equal(out.has('authorization'), false)
  assert.equal(out.get('x-keep'), 'yes')
})
check('the pi-ai Copilot alias is stripped too', () => {
  const headers = new Headers({ 'cf-aig-authorization': 'x' })
  prepareWorkBuddyHeaders({}, headers)
  assert.equal(headers.has('cf-aig-authorization'), false)
})
check('a host without the hook signature is left alone', () => {
  assert.deepEqual(prepareWorkBuddyHeaders({}, {}), {})
  assert.equal(prepareWorkBuddyHeaders({}, undefined), undefined)
})

console.log('client integration')
check('the adapter adopts the new hook and the pure contract module', () => {
  const adapter = read('lib/adapter.js')
  assert.match(adapter, /from '\.\/compat\.js'/)
  assert.match(adapter, /prepareHeaders: prepareWorkBuddyHeaders/)
  assert.match(adapter, /buildWorkBuddyProfile/)
  assert.match(adapter, /capacityOf\(info\)/)
})
check('the host half reports its host contract to the card', () => {
  const index = read('lib/index.js')
  assert.match(index, /hostContract: HOST_CONTRACT/)
  assert.match(index, /const PLUGIN_VERSION = '0\.2\.0'/)
})
check('the card contributes a settings navigation icon', () => {
  const client = read('client.js')
  assert.match(client, /settings\.section\.icon/)
  assert.match(client, /id: SHARED_SECTION_ID/)
  assert.match(client, /WorkBuddySettingsIcon/)
  assert.match(client, /hostContract\.dsh/)
})
check('the settings language follows the host document language', () => {
  assert.match(read('client.js'), /document\.documentElement\?\.lang/)
})

console.log('locale coverage (six languages added in 0.2.2-rc.1)')
for (const code of ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt-br']) {
  check(`locale/${code}.json carries meta.title and meta.description`, () => {
    const doc = JSON.parse(read(`locale/${code}.json`))
    assert.equal(typeof doc.meta.title, 'string')
    assert.ok(doc.meta.title.length > 0)
    assert.ok(doc.meta.description.length > 0)
  })
}

console.log('stream relay regression')
check('the mid-flight warning uses the logger passed by the shim factory', () => {
  const shim = read('lib/shim.js')
  assert.match(shim, /async function relayStream\(res, upstreamRes, signal, logger\)/)
  assert.match(shim, /logger\?\.warn\?\.\('dsh-workbuddy-connect: upstream stream failed mid-flight'/)
  assert.ok(!/options\.logger\?/.test(shim), 'a stale options.logger call survived')
})

console.log(`\n${passed} compatibility checks passed`)
