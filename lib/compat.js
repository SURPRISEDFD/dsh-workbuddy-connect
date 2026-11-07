/**
 * The DeepSeek Harness v0.2.2-rc.1 host contract, in one pure module.
 *
 * Everything in here is deliberately free of `@deepseek-ai/*` and pi-ai
 * imports: the connector hand-assembles its pi-ai profiles instead of going
 * through `dsh-llm-pi-ai`'s internal `resolveProfiles()`, so every field the
 * host adds has to be adopted here, explicitly, and the compatibility test
 * has to be able to assert it without installing a whole DSH profile.
 *
 * @module dsh-workbuddy-connect/compat
 */

/** What this build of the connector was adapted and verified against. */
export const HOST_CONTRACT = Object.freeze({
  dsh: '0.2.2-rc.1',
  node: '24.9.0',
  cordis: '4.1.0',
  loader: '1.1.0',
  piAi: '1.3.0',
})

/**
 * Capacities for a catalog row that declares none.
 *
 * v0.2.2-rc.1 raised the host's *undeclared* custom-model defaults from
 * 262144 / 32768 to decimal 1M / 128K. WorkBuddy's gateways are smaller than
 * that (several measured ceilings are 100000 tokens), and the release notes
 * say so explicitly: "smaller endpoints should set explicit capacities to
 * avoid delayed compaction". Declaring the pre-0.2.2 numbers here keeps the
 * connector's behaviour unchanged across the host upgrade, and stops a
 * corrupted saved catalog row from inheriting a 1M window it cannot serve.
 */
export const WORKBUDDY_DEFAULT_CONTEXT_WINDOW = 262_144
export const WORKBUDDY_DEFAULT_MAX_TOKENS = 32_768

/**
 * Image-request budgets for one pi-ai route.
 *
 * `maxRequestImages` (default 50) and `imageOffloadCountQuantum` (default 10)
 * are new in v0.2.2-rc.1. They bound the *number* of retained image
 * occurrences, while `maxRequestImageBytes` bounds their encoded size. A
 * hand-built profile that omits them leaves the route with no count bound at
 * all, so a long image-heavy Session never triggers the host's oldest-image
 * offload. The values mirror the host's own defaults.
 */
export const REQUEST_IMAGE_BUDGETS = Object.freeze({
  maxRequestImageBytes: 20_971_520,
  maxRequestImages: 50,
  imageOffloadCountQuantum: 10,
  requestImagePixelBudget: 4_194_304,
  requestImageMaxBytes: 1_048_576,
})

/**
 * Resolve the two capacities a pi-ai model descriptor must always carry.
 *
 * Live catalog rows normally declare both, but a saved catalog written by an
 * older build (or a partially parsed upstream row) may not. Letting those
 * fall through to v0.2.2's 1M/128K defaults would delay compaction until
 * long after the gateway's real token ceiling.
 *
 * @param {object} info One catalog row.
 * @returns {{contextWindow: number, maxTokens: number}}
 */
export function capacityOf(info) {
  const window = info?.contextWindow
  const output = info?.maxTokens
  return {
    contextWindow: Number.isFinite(window) && window > 0
      ? Math.floor(window)
      : WORKBUDDY_DEFAULT_CONTEXT_WINDOW,
    maxTokens: Number.isFinite(output) && output > 0
      ? Math.floor(output)
      : WORKBUDDY_DEFAULT_MAX_TOKENS,
  }
}

/**
 * Build one resolved pi-ai provider profile for this route.
 *
 * `defaultContextWindow` / `defaultMaxTokens` are config-level fields: they
 * matter if a future host build materializes models from the profile rather
 * than from our prebuilt `piProvider`. Setting them here keeps that path from
 * picking up v0.2.2's decimal 1M/128K defaults.
 *
 * @param {object} options
 * @param {string} options.key Registry key (the route, or the shared model identity).
 * @param {string} options.displayName Human-facing provider name.
 * @param {object} options.piProvider The pi-ai provider object for this key.
 * @param {number} options.streamIdleTimeoutMs Provider idle ceiling.
 * @param {object} options.retryPolicy Resolved host retry policy.
 * @param {string} options.reasoning Default reasoning tier.
 * @returns {object} A `ResolvedPiAiProviderProfile`-shaped object.
 */
export function buildWorkBuddyProfile(options) {
  const {
    key,
    displayName,
    piProvider,
    streamIdleTimeoutMs,
    retryPolicy,
    reasoning,
  } = options
  return {
    provider: key,
    displayName,
    streamIdleTimeoutMs,
    retryPolicy,
    configuredMaxTokens: new Map(),
    // Required since 0.1.5-alpha.2; the live catalog only exposes models the
    // upstream actually served, so there is never a per-model failure.
    modelErrors: new Map(),
    reasoning,
    defaultContextWindow: WORKBUDDY_DEFAULT_CONTEXT_WINDOW,
    defaultMaxTokens: WORKBUDDY_DEFAULT_MAX_TOKENS,
    ...REQUEST_IMAGE_BUDGETS,
    piProvider,
  }
}

/**
 * v0.2.2-rc.1's new `PiAiAdapter.prepareHeaders` hook.
 *
 * `dsh-llm-pi-ai` now prepares a `Headers` object per call (session identity
 * and request purpose are available on `request`) and applies Harness
 * attribution *after* this hook. pi-ai merges those headers last, and it
 * derives the OpenAI `Authorization` header from `options.apiKey` — the
 * loopback shim's per-process shared secret. A header named `authorization`
 * (or pi-ai's `cf-aig-authorization` alias) arriving from a profile or a
 * host overlay would therefore override that secret and make the shim reject
 * the request before any upstream call. Drop them and return the same object.
 *
 * Invalid header names now fail the call with `REQUEST_HEADERS` before any
 * inference I/O; this hook never throws.
 *
 * @param {Readonly<object>} _request Routing metadata (provider, model, sessionId, purpose).
 * @param {Headers} headers Request-owned headers initialized from the profile.
 * @returns {Headers} The same object.
 */
export function prepareWorkBuddyHeaders(_request, headers) {
  if (headers === null || typeof headers !== 'object') return headers
  if (typeof headers.delete !== 'function') return headers
  headers.delete('authorization')
  headers.delete('cf-aig-authorization')
  return headers
}
