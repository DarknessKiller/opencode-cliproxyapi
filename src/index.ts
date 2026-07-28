import type { Config, Plugin, PluginModule, PluginOptions } from "@opencode-ai/plugin"
import {
  discoverModelProtocols,
  discoverModels,
  normalizeBaseURL,
  type CatalogModel,
  type ModelProtocolCatalog,
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
        const [catalog, protocolDiscovery] = await Promise.all([
          discoverModels({
            baseURL,
            apiKey,
            timeoutMs,
          }),
          discoverProtocols({
            url: options.modelMetadataURL ?? DEFAULT_MODEL_METADATA_URL,
            timeoutMs,
          }),
        ])

        if (protocolDiscovery.error) {
          await client.app.log({
            body: {
              service: "opencode-cliproxyapi",
              level: "warn",
              message: protocolDiscovery.error,
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
  normalizeBaseURL,
  parseCatalog,
  parseModelProtocolCatalog,
} from "./catalog.js"
export type { CatalogModel, ModelProtocolCatalog } from "./catalog.js"

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
  },
) {
  const existing = config.provider?.[input.providerID]
  const discovered: Record<string, ModelConfig> = Object.fromEntries(
    input.catalog.map((model) => [
      model.id,
      {
        name: displayName(model.id),
        tool_call: !isImageModel(model.id),
        reasoning: isReasoningModel(model.id),
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

function isReasoningModel(modelID: string) {
  return /thinking|reasoning|codex|gpt-(?:5|oss)/i.test(modelID)
}

function supportsAttachments(modelID: string) {
  return /^(?:claude|gemini|gpt)/i.test(modelID)
}
