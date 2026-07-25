import type { Config, Plugin, PluginModule, PluginOptions } from "@opencode-ai/plugin"
import { discoverModels, normalizeBaseURL, type CatalogModel } from "./catalog.js"

const DEFAULT_BASE_URL = "http://localhost:8317/v1"
const DEFAULT_PROVIDER_ID = "cliproxyapi"
const DEFAULT_PROVIDER_NAME = "CLIProxyAPI"
const DEFAULT_DISCOVERY_TIMEOUT_MS = 10_000

type ConnectorOptions = {
  baseURL?: string
  apiKey?: string
  providerID?: string
  providerName?: string
  protocol?: "chat" | "responses"
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
        const catalog = await discoverModels({
          baseURL,
          apiKey,
          timeoutMs: options.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS,
        })

        addProvider(config, {
          providerID,
          providerName: options.providerName ?? DEFAULT_PROVIDER_NAME,
          baseURL,
          apiKey,
          protocol: options.protocol ?? "chat",
          catalog,
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
export { discoverModels, normalizeBaseURL, parseCatalog } from "./catalog.js"
export type { CatalogModel } from "./catalog.js"

function addProvider(
  config: Config,
  input: {
    providerID: string
    providerName: string
    baseURL: string
    apiKey?: string
    protocol: "chat" | "responses"
    catalog: CatalogModel[]
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
      models: {
        ...discovered,
        ...existing?.models,
      },
    },
  }
}

function readOptions(input?: PluginOptions): ConnectorOptions {
  if (!input) return {}

  return {
    baseURL: stringOption(input.baseURL),
    apiKey: stringOption(input.apiKey),
    providerID: stringOption(input.providerID),
    providerName: stringOption(input.providerName),
    protocol: input.protocol === "responses" ? "responses" : input.protocol === "chat" ? "chat" : undefined,
    discoveryTimeoutMs:
      typeof input.discoveryTimeoutMs === "number" && input.discoveryTimeoutMs > 0
        ? input.discoveryTimeoutMs
        : undefined,
  }
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
