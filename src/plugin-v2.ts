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
import { normalizeBaseURL } from "./catalog.js"
import {
  DEFAULT_BASE_URL,
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  DEFAULT_MODEL_METADATA_URL,
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_NAME,
  V2_ANTHROPIC_PACKAGE,
  V2_CHAT_PACKAGE,
  V2_RESPONSES_PACKAGE,
  discoverCatalog,
  displayName,
  isAnthropicRouted,
  isImageModel,
  readOptions,
  supportedEffortLevels,
  type CatalogDiscovery,
  type ConnectorOptions,
} from "./shared.js"

type Context = Plugin.Context

const DEFAULT_CONTEXT_LIMIT = 128_000
const DEFAULT_OUTPUT_LIMIT = 4_096

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
      input: image ? ["text", "image"] : ["text"],
      output: image ? ["image"] : ["text"],
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
    limit: { context: DEFAULT_CONTEXT_LIMIT, output: DEFAULT_OUTPUT_LIMIT },
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
 * V2 setup. Registers the provider from the discovered catalog and returns a
 * no-op cleanup (V2 keeps no timers or subscriptions for this plugin).
 */
export async function setup(ctx: Context): Promise<() => Promise<void>> {
  const options: ConnectorOptions = readOptions(ctx.options)
  const providerID = options.providerID ?? DEFAULT_PROVIDER_ID
  const baseURL = normalizeBaseURL(
    options.baseURL ?? process.env.CLIPROXY_BASE_URL ?? DEFAULT_BASE_URL,
  )
  const apiKey = options.apiKey ?? process.env.CLIPROXY_API_KEY
  const timeoutMs = options.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS
  const modelMetadataURL = options.modelMetadataURL ?? DEFAULT_MODEL_METADATA_URL

  const discovery = await discoverCatalog({ baseURL, apiKey, modelMetadataURL, timeoutMs })
  for (const error of discovery.errors) {
    console.warn(`[cliproxyapi] ${error}`)
  }

  const models = toV2Models({ providerID, discovery })
  const providerPackage =
    options.protocol === "responses" ? V2_RESPONSES_PACKAGE : V2_CHAT_PACKAGE

  await ctx.provider.transform((editor) => {
    const settings: Record<string, unknown> = { baseURL }
    if (apiKey) settings.apiKey = apiKey

    const existing = editor.get(providerID)
    if (existing) {
      editor.update(providerID, (provider) => {
        provider.name = provider.name || options.providerName || DEFAULT_PROVIDER_NAME
        provider.activation = "enabled"
        provider.package = providerPackage
        provider.settings = { ...provider.settings, ...settings }
      })
      editor.models.set(providerID, models as unknown as Model.Info[])
      return
    }

    const info: Provider.Info = {
      id: providerID as Provider.Info["id"],
      name: options.providerName ?? DEFAULT_PROVIDER_NAME,
      activation: "enabled",
      package: providerPackage,
      settings,
    }
    editor.add({ info, models: models as unknown as Model.Info[] })
  })

  return async () => {}
}

export const v2Definition = {
  id: "opencode-cliproxyapi",
  setup,
}
