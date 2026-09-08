export type CatalogModel = {
  id: string
  ownedBy?: string
}

export type ModelProtocolCatalog = Record<
  string,
  {
    npm?: string
    models: Record<string, string>
  }
>

export type ReasoningEffortLevels = {
  levels: string[]
  defaultLevel?: string
}

// Reasoning effort metadata CLIProxyAPI reports per model, indexed by model id.
export type ReasoningEffortCatalog = Record<string, ReasoningEffortLevels>

// CLIProxyAPI serves its codex-client model catalog (which carries per-model
// supported reasoning levels) whenever a client_version query is present.
// Any version >= 0.144.0 keeps the full effort set, so 1.0.0 is safe.
const REASONING_LEVELS_CLIENT_VERSION = "1.0.0"

type CatalogResponse = {
  data?: unknown
}

export function normalizeBaseURL(value: string) {
  const url = new URL(value)
  const pathname = url.pathname.replace(/\/+$/, "")
  url.pathname = pathname.endsWith("/v1") ? pathname : `${pathname}/v1`
  return url.toString().replace(/\/$/, "")
}

export function parseCatalog(input: unknown): CatalogModel[] {
  if (!isRecord(input)) throw new Error("CLIProxyAPI returned a non-object model catalog")

  const response: CatalogResponse = input
  if (!Array.isArray(response.data)) throw new Error("CLIProxyAPI model catalog is missing the data array")

  const models = response.data
    .map((item) => {
      if (!isRecord(item) || typeof item.id !== "string" || item.id.trim() === "") return
      return {
        id: item.id,
        ...(typeof item.owned_by === "string" ? { ownedBy: item.owned_by } : {}),
      }
    })
    .filter((item): item is CatalogModel => item !== undefined)

  if (models.length === 0) throw new Error("CLIProxyAPI returned no usable models")

  const unique = new Map<string, CatalogModel>()
  for (const model of models) {
    if (!unique.has(model.id)) unique.set(model.id, model)
  }
  return [...unique.values()]
}

export function parseReasoningEffortCatalog(input: unknown): ReasoningEffortCatalog {
  if (!isRecord(input) || !Array.isArray(input.models)) return {}

  const catalog: ReasoningEffortCatalog = {}
  for (const item of input.models) {
    if (!isRecord(item) || typeof item.slug !== "string" || item.slug.trim() === "") continue
    const rawLevels = item.supported_reasoning_levels
    if (!Array.isArray(rawLevels)) continue

    const levels = rawLevels
      .map((entry) => (isRecord(entry) && typeof entry.effort === "string" ? entry.effort : undefined))
      .filter((level): level is string => level !== undefined)
    if (levels.length === 0) continue

    const defaultLevel = typeof item.default_reasoning_level === "string" ? item.default_reasoning_level : undefined
    catalog[item.slug] = {
      levels: [...new Set(levels)],
      ...(defaultLevel ? { defaultLevel } : {}),
    }
  }
  return catalog
}

export async function discoverReasoningEfforts(input: {
  baseURL: string
  apiKey?: string
  timeoutMs: number
  fetcher?: typeof fetch
}): Promise<ReasoningEffortCatalog> {
  const response = await (input.fetcher ?? fetch)(
    `${input.baseURL}/models?client_version=${REASONING_LEVELS_CLIENT_VERSION}`,
    {
      headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : undefined,
      signal: AbortSignal.timeout(input.timeoutMs),
    },
  )

  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 300)
    throw new Error(
      `CLIProxyAPI reasoning-level discovery failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    )
  }

  return parseReasoningEffortCatalog(await response.json())
}

export async function discoverModels(input: {
  baseURL: string
  apiKey?: string
  timeoutMs: number
  fetcher?: typeof fetch
}) {
  const response = await (input.fetcher ?? fetch)(`${input.baseURL}/models`, {
    headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : undefined,
    signal: AbortSignal.timeout(input.timeoutMs),
  })

  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 300)
    throw new Error(
      `CLIProxyAPI model discovery failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    )
  }

  return parseCatalog(await response.json())
}

export function parseModelProtocolCatalog(input: unknown): ModelProtocolCatalog {
  if (!isRecord(input)) throw new Error("Model metadata service returned a non-object catalog")

  return Object.fromEntries(
    Object.entries(input).flatMap(([providerID, provider]) => {
      if (!isRecord(provider)) return []

      const models = Object.fromEntries(
        Object.entries(isRecord(provider.models) ? provider.models : {}).flatMap(([modelID, model]) => {
          if (!isRecord(model) || !isRecord(model.provider) || typeof model.provider.npm !== "string") {
            return []
          }
          return [[modelID, model.provider.npm]]
        }),
      )

      const npm = typeof provider.npm === "string" ? provider.npm : undefined
      return npm || Object.keys(models).length > 0
        ? [[providerID, { ...(npm ? { npm } : {}), models }]]
        : []
    }),
  )
}

export async function discoverModelProtocols(input: {
  url: string
  timeoutMs: number
  fetcher?: typeof fetch
}) {
  const response = await (input.fetcher ?? fetch)(input.url, {
    signal: AbortSignal.timeout(input.timeoutMs),
  })

  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 300)
    throw new Error(
      `Model protocol discovery failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    )
  }

  return parseModelProtocolCatalog(await response.json())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
