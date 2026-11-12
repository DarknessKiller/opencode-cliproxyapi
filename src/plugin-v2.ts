/**
 * OpenCode V2 entrypoint for CLIProxyAPI.
 *
 * V2 plugins default-export a definition with an `id` and a `setup(ctx)`
 * function; V1 plugin functions do not run on V2. This module ports the
 * discovery pipeline to the V2 provider API: it resolves the connector
 * options, runs the same catalog/protocol/effort discovery as V1, and
 * publishes the resulting provider through `ctx.provider.transform`.
 *
 * All `@opencode/plugin` imports are type-only, so the built plugin has no
 * runtime dependency on the V2 SDK.
 */
import type { Model, Plugin, Provider } from "@opencode/plugin"
import { isRecord, normalizeBaseURL } from "./catalog.js"
import {
  DEFAULT_BASE_URL,
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  DEFAULT_MODEL_METADATA_URL,
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_NAME,
  V2_ANTHROPIC_PACKAGE,
  V2_CHAT_PACKAGE,
  V2_RESPONSES_PACKAGE,
  definedKeys,
  discoverCatalog,
  displayName,
  isAnthropicRouted,
  isImageModel,
  isProperBoolean,
  isProperString,
  modelModalities,
  properLimitOverrides,
  readOptions,
  resolveModelLimits,
  supportedEffortLevels,
  type CatalogDiscovery,
  type ConnectorOptions,
} from "./shared.js"

type Context = Plugin.Context

export interface V2ModelVariant {
  id: string
  settings?: Record<string, unknown>
}

export interface V2ModelInfo {
  id: string
  modelID: string
  providerID: string
  name: string
  package?: string
  capabilities: {
    tools: boolean
    input: string[]
    output: string[]
  }
  variants: V2ModelVariant[]
  time: {
    released: number
  }
  cost: Array<{
    input: number
    output: number
    cache: { read: number; write: number }
  }>
  status: "active"
  enabled: boolean
  limit: {
    context: number
    output: number
  }
}

export function toV2Model(
  model: CatalogDiscovery["catalog"][number],
  input: { providerID: string; discovery: CatalogDiscovery },
): V2ModelInfo {
  const image = isImageModel(model.id)
  const modalities = modelModalities(model.id)
  const levels = supportedEffortLevels(model, input.discovery)
  const anthropic = isAnthropicRouted(model, input.discovery.protocolCatalog)

  return {
    id: model.id,
    modelID: model.id,
    providerID: input.providerID,
    name: displayName(model.id),
    ...(anthropic ? { package: V2_ANTHROPIC_PACKAGE } : {}),
    capabilities: {
      tools: !image,
      input: modalities.input,
      output: modalities.output,
    },
    // V2 does not generate default variants, so the picker shows exactly the
    // levels CLIProxyAPI reported.
    variants: (levels ?? []).map((level) => ({
      id: level,
      settings: { reasoningEffort: level },
    })),
    time: { released: 0 },
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    status: "active",
    enabled: true,
    limit: resolveModelLimits(model, input.discovery.effortCatalog),
  }
}

export function toV2Models(input: {
  providerID: string
  discovery: CatalogDiscovery
}): V2ModelInfo[] {
  return input.discovery.catalog.map((model) =>
    toV2Model(model, { providerID: input.providerID, discovery: input.discovery }),
  )
}

/**
 * Overlays the user's configured models on the discovered list. Discovery
 * provides the defaults; a user value wins only where it is a value V2 can
 * use, and a model the user configured alone is preserved verbatim.
 */
export function mergeV2Models(
  discovered: V2ModelInfo[],
  userModels?: ReadonlyMap<string, unknown>,
): V2ModelInfo[] {
  const merged = discovered.map((base) => {
    const userModel = userModels?.get(base.id)
    return isRecord(userModel) ? mergeV2Model(base, userModel) : base
  })

  if (userModels) {
    const discoveredIDs = new Set(discovered.map((model) => model.id))
    for (const [id, userModel] of userModels) {
      // A model the user configured outside discovery is preserved by design,
      // so it survives even if the catalog later drops it.
      if (!discoveredIDs.has(id) && isRecord(userModel)) merged.push(userModel as unknown as V2ModelInfo)
    }
  }

  return merged
}

function mergeV2Model(base: V2ModelInfo, userModel: Record<string, unknown>): V2ModelInfo {
  return {
    ...base,
    ...definedKeys(userModel),
    name: isProperString(userModel.name) ? userModel.name : base.name,
    package: isProperString(userModel.package) ? userModel.package : base.package,
    enabled: isProperBoolean(userModel.enabled) ? userModel.enabled : base.enabled,
    // Key-by-key: a user may raise or lower one limit and keep the other.
    limit: { ...base.limit, ...properLimitOverrides(userModel.limit) },
  }
}

/**
 * V2 setup. Registers the provider from the discovered catalog and returns a
 * no-op cleanup (V2 keeps no timers or subscriptions for this plugin).
 */
export async function setup(ctx: Context): Promise<() => Promise<void>> {
  const options: ConnectorOptions = readOptions(ctx.options)
  const providerID = options.providerID ?? DEFAULT_PROVIDER_ID
  const apiKey = options.apiKey ?? process.env.CLIPROXY_API_KEY
  const timeoutMs = options.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS
  const modelMetadataURL = options.modelMetadataURL ?? DEFAULT_MODEL_METADATA_URL
  let baseURL: string
  let discovery: CatalogDiscovery
  try {
    baseURL = normalizeBaseURL(
      options.baseURL ?? process.env.CLIPROXY_BASE_URL ?? DEFAULT_BASE_URL,
    )
    discovery = await discoverCatalog({ baseURL, apiKey, modelMetadataURL, timeoutMs })
  } catch (error) {
    console.warn(`[cliproxyapi] ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
  for (const error of discovery.errors) {
    console.warn(`[cliproxyapi] ${error}`)
  }

  const discovered = toV2Models({ providerID, discovery })
  const providerPackage =
    options.protocol === "responses" ? V2_RESPONSES_PACKAGE : V2_CHAT_PACKAGE

  await ctx.provider.transform((editor) => {
    const settings: Record<string, unknown> = { baseURL }
    if (apiKey) settings.apiKey = apiKey

    const existing = editor.get(providerID)
    const models = mergeV2Models(discovered, existing?.models) as unknown as Model.Info[]
    if (existing) {
      editor.update(providerID, (provider) => {
        provider.name = provider.name || options.providerName || DEFAULT_PROVIDER_NAME
        provider.activation = "enabled"
        provider.package = provider.package || providerPackage
        provider.settings = { ...provider.settings, ...settings }
      })
      editor.models.set(providerID, models)
      return
    }

    const info: Provider.Info = {
      id: providerID as Provider.Info["id"],
      name: options.providerName ?? DEFAULT_PROVIDER_NAME,
      activation: "enabled",
      package: providerPackage,
      settings,
    }
    editor.add({ info, models })
  })

  return async () => {}
}

export const v2Definition = {
  id: "opencode-cliproxyapi",
  setup,
}
