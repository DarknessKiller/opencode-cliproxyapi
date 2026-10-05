import type { Config, Plugin, PluginModule } from "@opencode-ai/plugin"
import { normalizeBaseURL, type CatalogModel, type ModelProtocolCatalog, type ReasoningEffortCatalog } from "./catalog.js"
import {
  DEFAULT_BASE_URL,
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  DEFAULT_MODEL_METADATA_URL,
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_NAME,
  V1_ANTHROPIC_PACKAGE,
  V1_CHAT_PACKAGE,
  V1_RESPONSES_PACKAGE,
  discoverCatalog,
  displayName,
  isImageModel,
  isReasoningModel,
  readOptions,
  resolveModelNpm,
  stringOption,
  supportedEffortLevels,
  supportsAttachments,
  type CatalogDiscovery,
  type ConnectorOptions,
} from "./shared.js"
import { setup } from "./plugin-v2.js"


type ProviderConfig = NonNullable<Config["provider"]>[string]
type ModelConfig = NonNullable<ProviderConfig["models"]>[string]
// OpenCode's config schema supports per-model variants; the pinned SDK types lag behind it.
type VariantConfig = { reasoningEffort?: string; disabled?: boolean }
type DiscoveredModelConfig = ModelConfig & {
  variants?: Record<string, VariantConfig>
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
        const discovery = await discoverCatalog({
          baseURL,
          apiKey,
          modelMetadataURL: options.modelMetadataURL ?? DEFAULT_MODEL_METADATA_URL,
          timeoutMs,
        })

        for (const message of discovery.errors) {
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
          catalog: discovery.catalog,
          protocolCatalog: discovery.protocolCatalog,
          effortCatalog: discovery.effortCatalog,
        })

        await client.app.log({
          body: {
            service: "opencode-cliproxyapi",
            level: "info",
            message: `Discovered ${discovery.catalog.length} CLIProxyAPI models from ${baseURL}`,
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

/**
 * Dual V1/V2 entry point. OpenCode V2 calls `setup(ctx)`; V1 (1.18.29 and
 * newer) calls `server(ctx)` for the classic hooks object.
 */
export default {
  id: "opencode-cliproxyapi",
  server: CLIProxyAPIPlugin,
  setup,
} satisfies PluginModule & { setup: typeof setup }
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
          V1_ANTHROPIC_PACKAGE
          ? {
              provider: {
                npm: V1_ANTHROPIC_PACKAGE,
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
        (input.protocol === "responses" ? V1_RESPONSES_PACKAGE : V1_CHAT_PACKAGE),
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

  const levels = supportedEffortLevels(model, input)
  if (!levels) return {}

  const defaultLevel =
    efforts.defaultLevel !== undefined && efforts.levels.includes(efforts.defaultLevel)
      ? efforts.defaultLevel
      : undefined

  return {
    ...(defaultLevel ? { options: { reasoningEffort: defaultLevel } } : {}),
    variants: {
      ...Object.fromEntries(efforts.levels.map((level) => [level, { reasoningEffort: level }])),
      // OpenCode merges its own per-model default variants (low/medium/high plus
      // family extras such as max for deepseek-v4) on top of config variants.
      // Disable every effort it might add that CLIProxyAPI did not report, so
      // the picker shows exactly the server-supported set.
      ...disabledVariants(efforts.levels),
    },
  }
}

// Effort keys OpenCode can generate by default for OpenAI-compatible models.
const OPENCODE_DEFAULT_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]

function disabledVariants(supported: string[]) {
  const supportedSet = new Set(supported)
  return Object.fromEntries(
    OPENCODE_DEFAULT_EFFORTS.filter((effort) => !supportedSet.has(effort)).map((effort) => [
      effort,
      { disabled: true },
    ]),
  )
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

