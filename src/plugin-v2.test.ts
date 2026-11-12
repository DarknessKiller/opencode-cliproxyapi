import { describe, expect, test } from "bun:test"
import pluginEntry from "./index.js"
import { mergeV2Models, setup, toV2Model, type V2ModelInfo } from "./plugin-v2.js"
import type { CatalogDiscovery } from "./shared.js"

const discovery: CatalogDiscovery = {
  catalog: [
    { id: "gpt-5.6-terra" },
    { id: "gemini-3.1-flash-image" },
    { id: "claude-sonnet-4-5", ownedBy: "anthropic" },
  ],
  protocolCatalog: {
    anthropic: { npm: "@ai-sdk/anthropic", models: {} },
  },
  effortCatalog: {
    "gpt-5.6-terra": { levels: ["low", "high", "none"], limit: { context: 200_000, output: 64_000 } },
  },
  errors: [],
}

describe("plugin-v2", () => {
  test("default export carries id, setup and the V1 server entry", () => {
    expect(pluginEntry.id).toBe("opencode-cliproxyapi")
    expect(typeof pluginEntry.setup).toBe("function")
    expect(typeof pluginEntry.server).toBe("function")
  })

  test("toV2Model maps capabilities, effort variants and routing", () => {
    const [terra, image, claude] = discovery.catalog.map((model) =>
      toV2Model(model, { providerID: "cliproxyapi", discovery }),
    ) as V2ModelInfo[]

    expect(terra.capabilities).toEqual({ tools: true, input: ["text", "image"], output: ["text"] })
    // "none" is never offered as a variant; the rest come from the API catalog.
    expect(terra.variants).toEqual([
      { id: "low", settings: { reasoningEffort: "low" } },
      { id: "high", settings: { reasoningEffort: "high" } },
    ])

    expect(image.capabilities).toEqual({ tools: false, input: ["text", "image"], output: ["image"] })

    expect(claude.capabilities).toEqual({ tools: true, input: ["text", "image"], output: ["text"] })
    expect(claude.package).toBe("@opencode/ai/providers/anthropic")
    expect(claude.variants).toEqual([])
    expect(terra.package).toBeUndefined()
  })

  test("toV2Model declares image input for vision families only", () => {
    const capabilities = (id: string) =>
      toV2Model({ id }, { providerID: "cliproxyapi", discovery }).capabilities
    const vision = { tools: true, input: ["text", "image"], output: ["text"] }
    const text = { tools: true, input: ["text"], output: ["text"] }

    expect(capabilities("claude-opus-example")).toEqual(vision)
    expect(capabilities("Gemini-Example-Pro")).toEqual(vision)
    expect(capabilities("gpt-example-mini")).toEqual(vision)
    expect(capabilities("gpt-oss-120b")).toEqual(text)
    expect(capabilities("deepseek-v4")).toEqual(text)
    expect(capabilities("gpt-image-example")).toEqual({
      tools: false,
      input: ["text", "image"],
      output: ["image"],
    })
  })

  test("setup registers the provider with the discovered models", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => Response.json({ data: [{ id: "gpt-5.6-terra" }] })

    try {
      const calls: {
        added?: { info: Record<string, unknown>; models: V2ModelInfo[] }
        updated?: Record<string, unknown>
        modelsSet?: { id: string; models: V2ModelInfo[] }
      } = {}

      const ctx = {
        options: { baseURL: "http://cliproxy.test:8317", apiKey: "secret" },
        provider: {
          transform: async (cb: (editor: unknown) => void) =>
            cb({
              get: () => undefined,
              add: (arg: { info: Record<string, unknown>; models: V2ModelInfo[] }) => {
                calls.added = arg
              },
              update: (id: string, mutate: (provider: Record<string, unknown>) => void) => {
                const provider: Record<string, unknown> = { id }
                mutate(provider)
                calls.updated = provider
              },
              models: {
                set: (id: string, models: V2ModelInfo[]) => {
                  calls.modelsSet = { id, models }
                },
              },
            }),
        },
      }

      const cleanup = await setup(ctx as never)
      expect(typeof cleanup).toBe("function")

      expect(calls.added?.info).toMatchObject({
        id: "cliproxyapi",
        name: "CLIProxyAPI",
        activation: "enabled",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: "http://cliproxy.test:8317/v1", apiKey: "secret" },
      })
      expect(calls.added?.models.map((model) => model.id)).toEqual(["gpt-5.6-terra"])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("setup fills in an existing provider row instead of adding one", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => Response.json({ data: [{ id: "gpt-5.6-terra" }] })

    try {
      const calls: {
        added?: unknown
        updated?: Record<string, unknown>
        modelsSet?: { id: string; models: V2ModelInfo[] }
      } = {}

      const ctx = {
        options: {
          baseURL: "http://cliproxy.test:8317",
          protocol: "responses",
          providerName: "Custom Name",
        },
        provider: {
          transform: async (cb: (editor: unknown) => void) =>
            cb({
              get: () => ({ provider: { id: "cliproxyapi" }, models: new Map() }),
              add: (arg: unknown) => {
                calls.added = arg
              },
              update: (id: string, mutate: (provider: Record<string, unknown>) => void) => {
                const provider: Record<string, unknown> = { id, name: "", settings: { timeout: 1 } }
                mutate(provider)
                calls.updated = provider
              },
              models: {
                set: (id: string, models: V2ModelInfo[]) => {
                  calls.modelsSet = { id, models }
                },
              },
            }),
        },
      }

      await setup(ctx as never)

      expect(calls.added).toBeUndefined()
      expect(calls.updated).toMatchObject({
        id: "cliproxyapi",
        activation: "enabled",
        package: "@opencode/ai/providers/openai",
        settings: { timeout: 1, baseURL: "http://cliproxy.test:8317/v1" },
      })
      expect(calls.modelsSet?.models.map((model) => model.id)).toEqual(["gpt-5.6-terra"])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
  test("toV2Model takes limits from the catalog, else the defaults", () => {
    const [terra, image] = discovery.catalog.map((model) =>
      toV2Model(model, { providerID: "cliproxyapi", discovery }),
    ) as V2ModelInfo[]

    expect(terra.limit).toEqual({ context: 200_000, output: 64_000 })
    expect(image.limit).toEqual({ context: 128_000, output: 32_000 })
  })

  test("mergeV2Models applies usable user overrides and appends config-only models", () => {
    const [terra, image] = discovery.catalog.map((model) =>
      toV2Model(model, { providerID: "cliproxyapi", discovery }),
    ) as V2ModelInfo[]
    const configOnly = { id: "config-only", name: "Config Only" } as unknown as V2ModelInfo
    const userModels = new Map<string, unknown>([
      [
        "gpt-5.6-terra",
        {
          name: "",
          package: "@custom/package",
          enabled: false,
          limit: { context: 250_000, output: 0 },
          variants: [{ id: "custom" }],
          settings: { effort: "high" },
        },
      ],
      ["gemini-3.1-flash-image", { limit: { context: 999 } }],
      ["config-only", configOnly],
    ])

    const merged = mergeV2Models([terra, image], userModels)

    expect(merged.map((model) => model.id)).toEqual([
      "gpt-5.6-terra",
      "gemini-3.1-flash-image",
      "config-only",
    ])
    // Empty name ignored; package/enabled/variants/settings win as a whole.
    expect(merged[0]).toMatchObject({
      name: "GPT 5.6 Terra",
      package: "@custom/package",
      enabled: false,
      limit: { context: 250_000, output: 64_000 },
      variants: [{ id: "custom" }],
      settings: { effort: "high" },
    })
    // Context-only override keeps the discovered output limit.
    expect(merged[1].limit).toEqual({ context: 999, output: 32_000 })
    expect(merged[2]).toBe(configOnly)
  })

  test("setup merges the existing provider's user models", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => Response.json({ data: [{ id: "gpt-5.6-terra" }] })

    try {
      const calls: { modelsSet?: { id: string; models: V2ModelInfo[] } } = {}
      const ctx = {
        options: { baseURL: "http://cliproxy.test:8317" },
        provider: {
          transform: async (cb: (editor: unknown) => void) =>
            cb({
              get: () => ({
                provider: { id: "cliproxyapi" },
                models: new Map([
                  ["gpt-5.6-terra", { name: "User Terra", limit: { context: 200_000 } }],
                ]),
              }),
              add: () => {},
              update: (_id: string, mutate: (provider: Record<string, unknown>) => void) => {
                mutate({ id: "cliproxyapi" })
              },
              models: {
                set: (id: string, models: V2ModelInfo[]) => {
                  calls.modelsSet = { id, models }
                },
              },
            }),
        },
      }

      await setup(ctx as never)

      expect(calls.modelsSet?.models).toHaveLength(1)
      expect(calls.modelsSet?.models[0]).toMatchObject({
        id: "gpt-5.6-terra",
        name: "User Terra",
        limit: { context: 200_000, output: 32_000 },
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("mergeV2Models skips non-object user entries", () => {
    const discovered = discovery.catalog.map((model) =>
      toV2Model(model, { providerID: "cliproxyapi", discovery }),
    )
    const merged = mergeV2Models(
      discovered,
      new Map<string, unknown>([
        ["gpt-5.6-terra", null],
        ["ghost-model", "x"],
      ]),
    )

    expect(merged).toHaveLength(discovered.length)
    expect(merged[0]).toEqual(discovered[0])
  })
})
