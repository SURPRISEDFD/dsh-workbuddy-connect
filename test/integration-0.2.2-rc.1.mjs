/**
 * Optional integration check against the real DeepSeek Harness v0.2.2-rc.1
 * packages. It loads the connector's host half with the host's own classes,
 * so a field the adapter hand-assembles incorrectly fails here rather than
 * inside a running DSH.
 *
 * Requires the host packages to be resolvable from this checkout:
 *   @deepseek-ai/dsh-llm@0.2.2-rc.1
 *   @deepseek-ai/dsh-llm-pi-ai@0.2.2-rc.1
 *   @earendil-works/pi-ai@1.3.0
 *
 * When they are absent the script prints SKIP and exits 0: `npm test` stays
 * dependency-free. Run explicitly with `npm run test:integration`.
 */
import assert from 'node:assert/strict'

let adapterModule
let hostModule
let catalogModule
try {
  adapterModule = await import('../lib/adapter.js')
  hostModule = await import('@deepseek-ai/dsh-llm-pi-ai')
  catalogModule = await import('../lib/catalog.js')
} catch (error) {
  const missing = error?.code === 'ERR_MODULE_NOT_FOUND'
    || /Cannot find package|Cannot find module/u.test(String(error?.message ?? ''))
  if (!missing) throw error
  console.log('SKIP  host packages are not installed in this checkout; '
    + 'install @deepseek-ai/dsh-llm-pi-ai@0.2.2-rc.1 to run this check.')
  process.exit(0)
}

const { createWorkBuddyAdapter } = adapterModule
const { PiAiAdapter } = hostModule
const { WorkBuddyCatalog, fallbackFor } = catalogModule

let passed = 0
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed++
    console.log(`  ok  ${name}`)
  }, (error) => {
    console.error(`FAIL  ${name}\n      ${error.message}`)
    process.exitCode = 1
  })
}

const catalog = new WorkBuddyCatalog({ region: 'global', initial: fallbackFor('global') })
const shim = {
  baseUrl: () => 'http://127.0.0.1:39319',
  token: () => 'integration-secret',
  ready: Promise.resolve(true),
  close: async () => {},
}
const built = createWorkBuddyAdapter({
  shim,
  catalog,
  providerId: 'workbuddy-global',
  displayName: 'WorkBuddy AI',
  modelIdentity: 'workbuddy',
})

await check('the adapter is a real v0.2.2-rc.1 PiAiAdapter', () => {
  assert.ok(built.adapter instanceof PiAiAdapter)
})
await check('providerInfo resolves the route', () => {
  assert.equal(built.adapter.providerInfo('workbuddy-global').id, 'workbuddy-global')
})
await check('listModels serves the built-in roster', async () => {
  const models = await built.adapter.listModels('workbuddy-global')
  assert.ok(models.length > 0)
})
await check('resolveModel returns a positive context window', async () => {
  const resolved = await built.adapter.resolveModel('workbuddy-global', 'default-model')
  assert.equal(resolved.context.contextWindow, 176_000)
})
await check('the pi-ai descriptor carries both capacities', () => {
  const model = built.adapter.current().models.getModel('workbuddy-global', 'default-model')
  assert.equal(model.contextWindow, 176_000)
  assert.equal(model.maxTokens, 24_000)
})
await check('prepareHeaders protects the shim bearer', () => {
  const headers = new Headers({ authorization: 'Bearer spoof', 'x-dsh-keep': '1' })
  const out = built.adapter.config.prepareHeaders({ provider: 'workbuddy-global', model: 'default-model' }, headers)
  assert.equal(out.has('authorization'), false)
  assert.equal(out.get('x-dsh-keep'), '1')
})
await check('an undeclared capacity does not inherit 1M/128K', async () => {
  catalog.set([{ id: 'no-capacity', name: 'No capacity', supportsImages: false, reasoning: { supports: false } }], 'live', Date.now())
  built.invalidate()
  const resolved = await built.adapter.resolveModel('workbuddy-global', 'no-capacity')
  const model = built.adapter.current().models.getModel('workbuddy-global', 'no-capacity')
  assert.equal(resolved.context.contextWindow, 262_144)
  assert.equal(model.maxTokens, 32_768)
})

console.log(`\n${passed} integration checks passed`)
