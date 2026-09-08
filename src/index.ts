import type { Config, Plugin, PluginModule, PluginOptions } from "@opencode-ai/plugin"
import {
  discoverModelProtocols,
  discoverModels,
  discoverReasoningEfforts,
  normalizeBaseURL,
  type CatalogModel,
  type ModelProtocolCatalog,
  type ReasoningEffortCatalog,
} from "./catalog.js"

const DEFAULT_BASE_URL = "http://localhost:8317/v1"
const DEFAULT_PROVIDER_ID = "cliproxyapi"
const DEFAULT_PROVIDER_NAME = "CLIProxyAPI"
const DEFAULT_DISCOVERY_TIMEOUT_MS = 10_000
const DEFAULT_MODEL_METADATA_URL = "https://models.dev/api.json"

type ConnectorOptions = {
  baseURL?: string
  apiKey?: string
  providerID?: string
  providerName?: string
  protocol?: "chat" | "responses"
  modelMetadataURL?: string | false
  discoveryTimeoutMs?: number
}

type ProviderConfig = NonNullable<Config["provider"]>[string]
type ModelConfig = NonNullable<ProviderConfig["models"]>[string]
// OpenCode's config schema supports per-model variants; the pinned SDK types lag behind it.
type DiscoveredModelConfig = ModelConfig & {
  variants?: Record<string, { reasoningEffort: string }>
}

export const CLIProxyAPIPlugin: Plugin = async ({ client }, rawOptions) => {
  const options = readOptions(rawOptions)

  return {
    config: async (config) => {
      const providerID = options.providerID ?? DEFAULT_PROVIDER_ID
      const existing = config.provider?.[providerID]
      const baseURL = normalizeBaseURL(
        options.baseURL ??
          process.env.CLIPROXY_BASE_URL ??
          stringOption(existing?.options?.baseURL) ??
          DEFAULT_BASE_URL,
      )
      const apiKey =
        options.apiKey ?? process.env.CLIPROXY_API_KEY ?? stringOption(existing?.options?.apiKey)

      try {
        const timeoutMs = options.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS
        const [catalog, protocolDiscovery, effortDiscovery] = await Promise.all([
          discoverModels({
            baseURL,
            apiKey,
            timeoutMs,
          }),
          discoverProtocols({
            url: options.modelMetadataURL ?? DEFAULT_MODEL_METADATA_URL,
            timeoutMs,
          }),
          discoverEffortLevels({
            baseURL,
            apiKey,
            timeoutMs,
          }),
        ])

        const discoveryErrors = [protocolDiscovery.error, effortDiscovery.error].filter(
          (error): error is string => error !== undefined,
        )
        for (const message of discoveryErrors) {
          await client.app.log({
            body: {
              service: "opencode-cliproxyapi",
              level: "warn",
              message,
            },
          })
        }

        addProvider(config, {
          providerID,
          providerName: options.providerName ?? DEFAULT_PROVIDER_NAME,
          baseURL,
          apiKey,
          protocol: options.protocol ?? "chat",
          catalog,
          protocolCatalog: protocolDiscovery.catalog,
          effortCatalog: effortDiscovery.catalog,
        })

        await client.app.log({
          body: {
            service: "opencode-cliproxyapi",
            level: "info",
            message: `Discovered ${catalog.length} CLIProxyAPI models from ${baseURL}`,
          },
        })
      } catch (error) {
        await client.app.log({
          body: {
            service: "opencode-cliproxyapi",
            level: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        })
        throw error
      }
    },
  }
}

export default {
  id: "opencode-cliproxyapi",
  server: CLIProxyAPIPlugin,
} satisfies PluginModule
export {
  discoverModelProtocols,
  discoverModels,
  discoverReasoningEfforts,
  normalizeBaseURL,
  parseCatalog,
  parseModelProtocolCatalog,
  parseReasoningEffortCatalog,
} from "./catalog.js"
export type { CatalogModel, ModelProtocolCatalog, ReasoningEffortCatalog } from "./catalog.js"

function addProvider(
  config: Config,
  input: {
    providerID: string
    providerName: string
    baseURL: string
    apiKey?: string
    protocol: "chat" | "responses"
    catalog: CatalogModel[]
    protocolCatalog: ModelProtocolCatalog
    effortCatalog: ReasoningEffortCatalog
  },
) {
  const existing = config.provider?.[input.providerID]
  const discovered: Record<string, DiscoveredModelConfig> = Object.fromEntries(
    input.catalog.map((model) => [
      model.id,
      {
        name: displayName(model.id),
        tool_call: !isImageModel(model.id),
        reasoning: isReasoningModel(model.id, input.effortCatalog[model.id]),
        attachment: supportsAttachments(model.id),
        ...(model.ownedBy &&
        resolveModelNpm(input.protocolCatalog, model.ownedBy, model.id) ===
          "@ai-sdk/anthropic"
          ? {
              provider: {
                npm: "@ai-sdk/anthropic",
              },
            }
          : {}),
        ...(isImageModel(model.id)
          ? {
              modalities: {
                input: ["text", "image"],
                output: ["image"],
              },
            }
          : {}),
        ...reasoningEffortConfig(model, input),
      },
    ]),
  )

  config.provider = {
    ...config.provider,
    [input.providerID]: {
      ...existing,
      name: existing?.name ?? input.providerName,
      npm:
        existing?.npm ??
        (input.protocol === "responses" ? "@ai-sdk/openai" : "@ai-sdk/openai-compatible"),
      env: [...new Set([...(existing?.env ?? []), "CLIPROXY_API_KEY"])],
      options: {
        ...existing?.options,
        baseURL: input.baseURL,
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      },
      models: mergeModels(discovered, existing?.models),
    },
  }
}

// Maps a model to the effort levels CLIProxyAPI itself reports for it. Levels
// arrive as OpenAI-style reasoning_effort values in the codex-client catalog;
// they only reach the wire unchanged on OpenAI-compatible transports, so
// Anthropic-routed models keep OpenCode's own Claude variant generation.
function reasoningEffortConfig(
  model: CatalogModel,
  input: { protocolCatalog: ModelProtocolCatalog; effortCatalog: ReasoningEffortCatalog },
): DiscoveredModelConfig {
  const efforts = input.effortCatalog[model.id]
  if (!efforts) return {}

  const anthropicRouted =
    model.ownedBy !== undefined &&
    resolveModelNpm(input.protocolCatalog, model.ownedBy, model.id) === "@ai-sdk/anthropic"
  if (anthropicRouted) return {}

  const levels = efforts.levels.filter((level) => level !== "none")
  if (levels.length === 0) return {}

  const defaultLevel =
    efforts.defaultLevel !== undefined && efforts.levels.includes(efforts.defaultLevel)
      ? efforts.defaultLevel
      : undefined

  return {
    ...(defaultLevel ? { options: { reasoningEffort: defaultLevel } } : {}),
    variants: Object.fromEntries(levels.map((level) => [level, { reasoningEffort: level }])),
  }
}

function resolveModelNpm(
  catalog: ModelProtocolCatalog,
  providerID: string,
  modelID: string,
): string | undefined {
  const provider = catalog[providerID]
  return provider?.models[modelID] ?? provider?.npm
}

function mergeModels(
  discovered: Record<string, ModelConfig>,
  existing: ProviderConfig["models"],
): Record<string, ModelConfig> {
  const merged = { ...discovered }

  for (const [modelID, model] of Object.entries(existing ?? {})) {
    const discoveredModel = merged[modelID]
    const providerNpm = model.provider?.npm ?? discoveredModel?.provider?.npm
    merged[modelID] = {
      ...discoveredModel,
      ...model,
      ...(providerNpm ? { provider: { npm: providerNpm } } : {}),
    }
  }

  return merged
}

function readOptions(input?: PluginOptions): ConnectorOptions {
  if (!input) return {}

  return {
    baseURL: stringOption(input.baseURL),
    apiKey: stringOption(input.apiKey),
    providerID: stringOption(input.providerID),
    providerName: stringOption(input.providerName),
    protocol: input.protocol === "responses" ? "responses" : input.protocol === "chat" ? "chat" : undefined,
    modelMetadataURL:
      input.modelMetadataURL === false ? false : stringOption(input.modelMetadataURL),
    discoveryTimeoutMs:
      typeof input.discoveryTimeoutMs === "number" && input.discoveryTimeoutMs > 0
        ? input.discoveryTimeoutMs
        : undefined,
  }
}

function discoverProtocols(input: {
  url: string | false
  timeoutMs: number
}): Promise<{ catalog: ModelProtocolCatalog; error?: string }> {
  if (input.url === false) return Promise.resolve({ catalog: {} as ModelProtocolCatalog })

  return discoverModelProtocols({
    url: input.url,
    timeoutMs: input.timeoutMs,
  })
    .then((catalog) => ({ catalog }))
    .catch((error) => ({
      catalog: {} as ModelProtocolCatalog,
      error: error instanceof Error ? error.message : String(error),
    }))
}

// Reasoning-level discovery is best-effort: CLIProxyAPI versions without the
// codex-client catalog simply keep models on their heuristic defaults.
function discoverEffortLevels(input: {
  baseURL: string
  apiKey?: string
  timeoutMs: number
}): Promise<{ catalog: ReasoningEffortCatalog; error?: string }> {
  return discoverReasoningEfforts(input)
    .then((catalog) => ({ catalog }))
    .catch((error) => ({
      catalog: {},
      error: error instanceof Error ? error.message : String(error),
    }))
}

function stringOption(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function displayName(modelID: string) {
  return modelID
    .split("-")
    .map((part) => {
      const lower = part.toLowerCase()
      if (lower === "gpt") return "GPT"
      if (lower === "oss") return "OSS"
      if (lower === "codex") return "Codex"
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(" ")
}

function isImageModel(modelID: string) {
  return /(?:^|-)image(?:-|$)/i.test(modelID)
}

// Reasoning-capable unless CLIProxyAPI's own effort catalog proves otherwise.
// A reported level list always wins over the id heuristic.
function isReasoningModel(modelID: string, efforts?: { levels: string[]; defaultLevel?: string }) {
  if (efforts?.levels.length) return efforts.levels.some((level) => level !== "none")
  return /thinking|reasoning|codex|gpt-(?:5|oss)/i.test(modelID)
}

function supportsAttachments(modelID: string) {
  return /^(?:claude|gemini|gpt)/i.test(modelID)
}
