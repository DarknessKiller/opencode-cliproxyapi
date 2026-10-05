import type { PluginOptions } from "@opencode-ai/plugin"
import {
  discoverModelProtocols,
  discoverModels,
  discoverReasoningEfforts,
  type CatalogModel,
  type ModelProtocolCatalog,
  type ReasoningEffortCatalog,
} from "./catalog.js"

export const DEFAULT_BASE_URL = "http://localhost:8317/v1"
export const DEFAULT_PROVIDER_ID = "cliproxyapi"
export const DEFAULT_PROVIDER_NAME = "CLIProxyAPI"
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 10_000
export const DEFAULT_MODEL_METADATA_URL = "https://models.dev/api.json"

// V1 driver packages (`@ai-sdk/*`) map to the OpenCode V2 provider packages.
export const V1_CHAT_PACKAGE = "@ai-sdk/openai-compatible"
export const V1_RESPONSES_PACKAGE = "@ai-sdk/openai"
export const V1_ANTHROPIC_PACKAGE = "@ai-sdk/anthropic"
export const V2_CHAT_PACKAGE = "@opencode/ai/providers/openai-compatible"
export const V2_RESPONSES_PACKAGE = "@opencode/ai/providers/openai"
export const V2_ANTHROPIC_PACKAGE = "@opencode/ai/providers/anthropic"

export type ConnectorOptions = {
  baseURL?: string
  apiKey?: string
  providerID?: string
  providerName?: string
  protocol?: "chat" | "responses"
  modelMetadataURL?: string | false
  discoveryTimeoutMs?: number
}

export type CatalogDiscovery = {
  catalog: CatalogModel[]
  protocolCatalog: ModelProtocolCatalog
  effortCatalog: ReasoningEffortCatalog
  errors: string[]
}

export function readOptions(input?: PluginOptions): ConnectorOptions {
  if (!input) return {}

  return {
    baseURL: stringOption(input.baseURL),
    apiKey: stringOption(input.apiKey),
    providerID: stringOption(input.providerID),
    providerName: stringOption(input.providerName),
    protocol:
      input.protocol === "responses" ? "responses" : input.protocol === "chat" ? "chat" : undefined,
    modelMetadataURL:
      input.modelMetadataURL === false ? false : stringOption(input.modelMetadataURL),
    discoveryTimeoutMs:
      typeof input.discoveryTimeoutMs === "number" && input.discoveryTimeoutMs > 0
        ? input.discoveryTimeoutMs
        : undefined,
  }
}

export function stringOption(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

export function displayName(modelID: string) {
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

export function isImageModel(modelID: string) {
  return /(?:^|-)image(?:-|$)/i.test(modelID)
}

// Reasoning-capable unless CLIProxyAPI's own effort catalog proves otherwise.
// A reported level list always wins over the id heuristic.
export function isReasoningModel(
  modelID: string,
  efforts?: { levels: string[]; defaultLevel?: string },
) {
  if (efforts?.levels.length) return efforts.levels.some((level) => level !== "none")
  return /thinking|reasoning|codex|gpt-(?:5|oss)/i.test(modelID)
}

export function supportsAttachments(modelID: string) {
  return /^(?:claude|gemini|gpt)/i.test(modelID)
}

export function resolveModelNpm(
  catalog: ModelProtocolCatalog,
  providerID: string,
  modelID: string,
): string | undefined {
  const provider = catalog[providerID]
  return provider?.models[modelID] ?? provider?.npm
}

export function isAnthropicRouted(
  model: CatalogModel,
  protocolCatalog: ModelProtocolCatalog,
): boolean {
  return (
    model.ownedBy !== undefined &&
    resolveModelNpm(protocolCatalog, model.ownedBy, model.id) === V1_ANTHROPIC_PACKAGE
  )
}

// Maps a model to the effort levels CLIProxyAPI itself reports for it. Levels
// arrive as OpenAI-style reasoning_effort values in the codex-client catalog;
// they only reach the wire unchanged on OpenAI-compatible transports, so
// Anthropic-routed models keep OpenCode's own Claude variant generation.
export function supportedEffortLevels(
  model: CatalogModel,
  input: { protocolCatalog: ModelProtocolCatalog; effortCatalog: ReasoningEffortCatalog },
): string[] | undefined {
  const efforts = input.effortCatalog[model.id]
  if (!efforts) return undefined
  if (isAnthropicRouted(model, input.protocolCatalog)) return undefined

  const levels = efforts.levels.filter((level) => level !== "none")
  return levels.length > 0 ? levels : undefined
}

// Runs the three discovery passes used by both entrypoints. Failures are
// collected instead of thrown: a missing protocol or effort catalog only
// degrades the generated model metadata.
export async function discoverCatalog(input: {
  baseURL: string
  apiKey?: string
  modelMetadataURL: string | false
  timeoutMs: number
}): Promise<CatalogDiscovery> {
  const [catalog, protocolDiscovery, effortDiscovery] = await Promise.all([
    discoverModels({ baseURL: input.baseURL, apiKey: input.apiKey, timeoutMs: input.timeoutMs }),
    discoverProtocols({ url: input.modelMetadataURL, timeoutMs: input.timeoutMs }),
    discoverEffortLevels({ baseURL: input.baseURL, apiKey: input.apiKey, timeoutMs: input.timeoutMs }),
  ])

  return {
    catalog,
    protocolCatalog: protocolDiscovery.catalog,
    effortCatalog: effortDiscovery.catalog,
    errors: [protocolDiscovery.error, effortDiscovery.error].filter(
      (error): error is string => error !== undefined,
    ),
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
