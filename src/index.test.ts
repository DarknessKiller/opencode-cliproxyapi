import { describe, expect, test } from "bun:test"
import type { Config, PluginInput } from "@opencode-ai/plugin"
import { CLIProxyAPIPlugin } from "./index.js"
import { toV2Model } from "./plugin-v2.js"

describe("CLIProxyAPIPlugin", () => {
  test("discovers models and merges the provider into OpenCode config", async () => {
    const requests: Request[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      requests.push(new Request(input, init))
      return Response.json({
        data: [{ id: "gpt-5.6-terra" }, { id: "gemini-3.1-flash-image" }],
      })
    }

    try {
      const logs: unknown[] = []
      const plugin = await CLIProxyAPIPlugin(
        {
          client: {
            app: {
              log: async (input: unknown) => {
                logs.push(input)
                return {}
              },
            },
          },
        } as PluginInput,
        {
          baseURL: "http://cliproxy.test:8317",
          apiKey: "secret",
        },
      )
      const config: Config = {
        provider: {
          cliproxyapi: {
            models: {
              "gpt-5.6-terra": {
                name: "My Terra",
              },
            },
          },
        },
      }

      await plugin.config?.(config)

      expect(requests).toHaveLength(3)
      const modelRequest = requests.find(
        (request) => request.url === "http://cliproxy.test:8317/v1/models",
      )
      expect(modelRequest?.headers.get("authorization")).toBe("Bearer secret")
      expect(requests.some((request) => request.url === "https://models.dev/api.json")).toBe(true)
      expect(
        requests.some((request) => request.url.startsWith("http://cliproxy.test:8317/v1/models?")),
      ).toBe(true)
      expect(config.provider?.cliproxyapi).toMatchObject({
        name: "CLIProxyAPI",
        npm: "@ai-sdk/openai-compatible",
        env: ["CLIPROXY_API_KEY"],
        options: {
          baseURL: "http://cliproxy.test:8317/v1",
          apiKey: "secret",
        },
        models: {
          "gpt-5.6-terra": {
            name: "My Terra",
          },
          "gemini-3.1-flash-image": {
            name: "Gemini 3.1 Flash Image",
            attachment: true,
            tool_call: false,
          },
        },
      })
      expect(logs).toHaveLength(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("routes models from dynamic catalog protocol metadata", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      if (String(input) === "https://models.dev/api.json") {
        return Response.json({
          acme: {
            npm: "@ai-sdk/anthropic",
            models: {
              "model-level-chat": {
                provider: {
                  npm: "@ai-sdk/openai-compatible",
                },
              },
            },
          },
          chat: {
            npm: "@ai-sdk/openai-compatible",
            models: {},
          },
        })
      }

      return Response.json({
        data: [
          { id: "chat-model", owned_by: "chat" },
          { id: "messages-model", owned_by: "acme" },
          { id: "model-level-chat", owned_by: "acme" },
        ],
      })
    }

    try {
      const plugin = await CLIProxyAPIPlugin(
        {
          client: {
            app: {
              log: async () => ({}),
            },
          },
        } as PluginInput,
        {
          baseURL: "http://cliproxy.test:8317",
          apiKey: "secret",
        },
      )
      const config: Config = {
        provider: {
          cliproxyapi: {
            models: {
              "messages-model": {
                name: "My Messages Model",
              },
            },
          },
        },
      }

      await plugin.config?.(config)

      expect(config.provider?.cliproxyapi?.npm).toBe("@ai-sdk/openai-compatible")
      expect(config.provider?.cliproxyapi?.models?.["chat-model"]?.provider).toBeUndefined()
      expect(config.provider?.cliproxyapi?.models?.["messages-model"]?.name).toBe("My Messages Model")
      expect(config.provider?.cliproxyapi?.models?.["messages-model"]?.provider).toEqual({
        npm: "@ai-sdk/anthropic",
      })
      expect(config.provider?.cliproxyapi?.models?.["model-level-chat"]?.provider).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("keeps discovered models available when protocol metadata is unavailable", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      if (String(input) === "https://models.dev/api.json") {
        return Response.json({ error: "unavailable" }, { status: 503 })
      }
      return Response.json({
        data: [{ id: "chat-model", owned_by: "acme" }],
      })
    }

    try {
      const logs: unknown[] = []
      const plugin = await CLIProxyAPIPlugin(
        {
          client: {
            app: {
              log: async (input: unknown) => {
                logs.push(input)
                return {}
              },
            },
          },
        } as PluginInput,
        {
          baseURL: "http://cliproxy.test:8317",
        },
      )
      const config: Config = {}

      await plugin.config?.(config)

      expect(config.provider?.cliproxyapi?.models?.["chat-model"]).toBeDefined()
      expect(logs).toHaveLength(2)
      expect(logs[0]).toMatchObject({
        body: {
          level: "warn",
          message: expect.stringContaining("HTTP 503"),
        },
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("configures effort levels and default from CLIProxyAPI's own catalog", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url.startsWith("http://cliproxy.test:8317/v1/models?")) {
        return Response.json({
          models: [
            {
              slug: "gpt-5.6-terra",
              supported_reasoning_levels: [
                { effort: "none" },
                { effort: "low" },
                { effort: "medium" },
                { effort: "high" },
                { effort: "xhigh" },
                { effort: "max" },
              ],
              default_reasoning_level: "medium",
            },
            {
              slug: "gemini-3.1-pro-low",
              supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
              default_reasoning_level: "low",
            },
          ],
        })
      }
      if (url === "https://models.dev/api.json") {
        return Response.json({
          anthropic: {
            npm: "@ai-sdk/anthropic",
            models: {},
          },
        })
      }
      return Response.json({
        data: [
          { id: "gpt-5.6-terra", owned_by: "openai" },
          { id: "gemini-3.1-pro-low", owned_by: "google" },
          { id: "claude-sonnet-4-6", owned_by: "anthropic" },
          { id: "plain-model", owned_by: "acme" },
        ],
      })
    }

    try {
      const plugin = await CLIProxyAPIPlugin(
        {
          client: {
            app: {
              log: async () => ({}),
            },
          },
        } as PluginInput,
        {
          baseURL: "http://cliproxy.test:8317",
          apiKey: "secret",
        },
      )
      const config: Config = {}

      await plugin.config?.(config)

      const models = config.provider?.cliproxyapi?.models
      expect(models?.["gpt-5.6-terra"]).toMatchObject({
        reasoning: true,
        options: { reasoningEffort: "medium" },
        variants: {
          none: { reasoningEffort: "none" },
          low: { reasoningEffort: "low" },
          medium: { reasoningEffort: "medium" },
          high: { reasoningEffort: "high" },
          xhigh: { reasoningEffort: "xhigh" },
          max: { reasoningEffort: "max" },
          // OpenCode defaults that the server does not report stay disabled.
          minimal: { disabled: true },
          ultra: { disabled: true },
        },
      })
      expect(models?.["gemini-3.1-pro-low"]).toMatchObject({
        reasoning: true,
        options: { reasoningEffort: "low" },
        variants: {
          low: { reasoningEffort: "low" },
          high: { reasoningEffort: "high" },
          none: { disabled: true },
          minimal: { disabled: true },
          medium: { disabled: true },
          xhigh: { disabled: true },
          max: { disabled: true },
          ultra: { disabled: true },
        },
      })
      // Anthropic-routed models keep OpenCode's Claude variant generation.
      expect(models?.["claude-sonnet-4-6"]).toMatchObject({
        provider: { npm: "@ai-sdk/anthropic" },
      })
      expect(models?.["claude-sonnet-4-6"]?.variants).toBeUndefined()
      expect(models?.["claude-sonnet-4-6"]?.options).toBeUndefined()
      // A model the server reports with no effort levels falls back to heuristics.
      expect(models?.["plain-model"]?.reasoning).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("does not leak OpenCode default efforts the server did not report", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url.startsWith("http://cliproxy.test:8317/v1/models?")) {
        return Response.json({
          models: [
            {
              slug: "deepseek-v4",
              supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "max" }],
              default_reasoning_level: "high",
            },
          ],
        })
      }
      return Response.json({ data: [{ id: "deepseek-v4", owned_by: "deepseek" }] })
    }

    try {
      const plugin = await CLIProxyAPIPlugin(
        {
          client: {
            app: {
              log: async () => ({}),
            },
          },
        } as PluginInput,
        { baseURL: "http://cliproxy.test:8317" },
      )
      const config: Config = {}

      await plugin.config?.(config)

      const variants = config.provider?.cliproxyapi?.models?.["deepseek-v4"]?.variants
      expect(Object.keys(variants ?? {}).filter((key) => !variants?.[key]?.disabled)).toEqual([
        "low",
        "high",
        "max",
      ])
      // OpenCode would otherwise add its own default "medium" effort here.
      expect(variants?.["medium"]).toEqual({ disabled: true })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("declares image input for discovered vision models without user config", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      if (String(input) === "https://models.dev/api.json") {
        return Response.json({ anthropic: { npm: "@ai-sdk/anthropic", models: {} } })
      }
      return Response.json({
        data: [
          { id: "claude-opus-example", owned_by: "anthropic" },
          { id: "gemini-example-pro" },
          { id: "gpt-example-codex" },
          { id: "gpt-oss-120b" },
          { id: "deepseek-v4" },
          { id: "gemini-3.1-flash-image" },
          { id: "claude-sonnet-custom" },
        ],
      })
    }

    try {
      const plugin = await CLIProxyAPIPlugin(
        { client: { app: { log: async () => ({}) } } } as PluginInput,
        { baseURL: "http://cliproxy.test:8317" },
      )
      const config: Config = {
        provider: {
          cliproxyapi: {
            models: {
              // An explicit user override still wins over the heuristic.
              "claude-sonnet-custom": { modalities: { input: ["text"], output: ["text"] } },
            },
          },
        },
      }

      await plugin.config?.(config)

      const models = config.provider?.cliproxyapi?.models
      const vision = { input: ["text", "image"], output: ["text"] }
      for (const id of ["claude-opus-example", "gemini-example-pro", "gpt-example-codex"]) {
        expect(models?.[id]).toMatchObject({ attachment: true, tool_call: true, modalities: vision })
      }
      // Routing is unaffected by the capability metadata.
      expect(models?.["claude-opus-example"]?.provider).toEqual({ npm: "@ai-sdk/anthropic" })

      // Text-only models keep OpenCode's defaults.
      for (const id of ["gpt-oss-120b", "deepseek-v4"]) {
        expect(models?.[id]?.attachment).toBe(false)
        expect(models?.[id]?.modalities).toBeUndefined()
      }

      // Image generation keeps image output and no tools.
      expect(models?.["gemini-3.1-flash-image"]).toMatchObject({
        tool_call: false,
        modalities: { input: ["text", "image"], output: ["image"] },
      })

      expect(models?.["claude-sonnet-custom"]?.modalities).toEqual({
        input: ["text"],
        output: ["text"],
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("V1 modalities match V2 capabilities for discovered models", async () => {
    const ids = [
      "claude-opus-example",
      "gemini-example-pro",
      "gpt-example",
      "gpt-oss-20b",
      "deepseek-v4",
      "gemini-3.1-flash-image",
    ]
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => Response.json({ data: ids.map((id) => ({ id })) })

    try {
      const plugin = await CLIProxyAPIPlugin(
        { client: { app: { log: async () => ({}) } } } as PluginInput,
        { baseURL: "http://cliproxy.test:8317", modelMetadataURL: false },
      )
      const config: Config = {}
      await plugin.config?.(config)

      const discovery = {
        catalog: ids.map((id) => ({ id })),
        protocolCatalog: {},
        effortCatalog: {},
        errors: [],
      }
      for (const id of ids) {
        const v1 = config.provider?.cliproxyapi?.models?.[id]
        const v2 = toV2Model({ id }, { providerID: "cliproxyapi", discovery })
        expect(v1?.modalities?.input ?? ["text"]).toEqual(v2.capabilities.input as never)
        expect(v1?.modalities?.output ?? ["text"]).toEqual(v2.capabilities.output as never)
        expect(v1?.tool_call).toBe(v2.capabilities.tools)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("keeps heuristic defaults when the server has no effort catalog", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      Response.json({
        data: [{ id: "gpt-5.6-terra", owned_by: "openai" }],
      })

    try {
      const plugin = await CLIProxyAPIPlugin(
        {
          client: {
            app: {
              log: async () => ({}),
            },
          },
        } as PluginInput,
        {
          baseURL: "http://cliproxy.test:8317",
        },
      )
      const config: Config = {}

      await plugin.config?.(config)

      const model = config.provider?.cliproxyapi?.models?.["gpt-5.6-terra"]
      expect(model?.reasoning).toBe(true)
      expect(model?.variants).toBeUndefined()
      expect(model?.options).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
  test("emits catalog limits on discovered models", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url.startsWith("http://cliproxy.test:8317/v1/models?")) {
        return Response.json({
          models: [{ slug: "gpt-5.6-terra", context_window: 200_000, max_tokens: 64_000 }],
        })
      }
      return Response.json({ data: [{ id: "gpt-5.6-terra" }, { id: "plain-model" }] })
    }

    try {
      const plugin = await CLIProxyAPIPlugin(
        { client: { app: { log: async () => ({}) } } } as PluginInput,
        { baseURL: "http://cliproxy.test:8317", modelMetadataURL: false },
      )
      const config: Config = {}

      await plugin.config?.(config)

      expect(config.provider?.cliproxyapi?.models?.["gpt-5.6-terra"]?.limit).toEqual({
        context: 200_000,
        output: 64_000,
      })
      expect(config.provider?.cliproxyapi?.models?.["plain-model"]?.limit).toEqual({
        context: 128_000,
        output: 32_000,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("merges user model overrides field by field", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url.startsWith("http://cliproxy.test:8317/v1/models?")) {
        return Response.json({
          models: [
            {
              slug: "gpt-5.6-terra",
              context_window: 200_000,
              max_tokens: 64_000,
              supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
            },
          ],
        })
      }
      return Response.json({
        data: [{ id: "gpt-5.6-terra" }, { id: "plain-model" }, { id: "second-model" }],
      })
    }

    try {
      const plugin = await CLIProxyAPIPlugin(
        { client: { app: { log: async () => ({}) } } } as PluginInput,
        { baseURL: "http://cliproxy.test:8317", modelMetadataURL: false },
      )
      const config = {
        provider: {
          cliproxyapi: {
            models: {
              "gpt-5.6-terra": {
                name: "",
                tool_call: false,
                limit: { context: 300_000, output: 0 },
                variants: { low: { reasoningEffort: "high", disabled: false } },
                provider: { npm: "@custom/package" },
              },
              "plain-model": { name: null, limit: { output: 8_192 } },
              "second-model": { limit: { context: 1_000, output: 0 } },
              "config-only-model": { name: "Config Only", tool_call: true },
            },
          },
        },
      } as Config

      await plugin.config?.(config)

      const models = config.provider?.cliproxyapi?.models
      // Empty name ignored, tool_call flip wins, context raised, output 0 ignored.
      expect(models?.["gpt-5.6-terra"]).toMatchObject({
        name: "GPT 5.6 Terra",
        tool_call: false,
        limit: { context: 300_000, output: 64_000 },
        provider: { npm: "@custom/package" },
      })
      // Variants are replaced whole: the discovered low/high set is gone.
      expect(models?.["gpt-5.6-terra"]?.variants).toEqual({
        low: { reasoningEffort: "high", disabled: false },
      })
      // Null name is not usable; only the output limit is overridden.
      expect(models?.["plain-model"]?.name).toBe("Plain Model")
      expect(models?.["plain-model"]?.limit).toEqual({ context: 128_000, output: 8_192 })
      // A lowered context wins; output 0 never does.
      expect(models?.["second-model"]?.limit).toEqual({ context: 1_000, output: 32_000 })
      expect(models?.["config-only-model"]).toEqual({ name: "Config Only", tool_call: true })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("ignores user values a discovered model cannot use", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      Response.json({
        data: [
          { id: "gpt-5.6-terra" },
          { id: "plain-model" },
          { id: "second-model" },
          { id: "third-model" },
          { id: "null-model" },
        ],
      })

    try {
      const plugin = await CLIProxyAPIPlugin(
        { client: { app: { log: async () => ({}) } } } as PluginInput,
        { baseURL: "http://cliproxy.test:8317", modelMetadataURL: false },
      )
      const config = {
        provider: {
          cliproxyapi: {
            models: {
              // Built programmatically: JSON cannot express an explicit undefined.
              "gpt-5.6-terra": { name: undefined, tool_call: undefined },
              "plain-model": { limit: "8192" },
              "second-model": { limit: ["x"] },
              "third-model": { limit: null },
              "null-model": null,
              "config-only-null": null,
            },
          },
        },
      } as unknown as Config

      await plugin.config?.(config)

      const models = config.provider?.cliproxyapi?.models
      expect(models?.["gpt-5.6-terra"]?.name).toBe("GPT 5.6 Terra")
      expect(models?.["gpt-5.6-terra"]?.tool_call).toBe(true)
      for (const modelID of ["plain-model", "second-model", "third-model"]) {
        expect(models?.[modelID]?.limit).toEqual({ context: 128_000, output: 32_000 })
      }
      // A non-object entry for a discovered id cannot override anything.
      expect(models?.["null-model"]?.name).toBe("Null Model")
      expect(models?.["null-model"]?.limit).toEqual({ context: 128_000, output: 32_000 })
      // A non-object entry with no discovered model is skipped entirely.
      expect(models?.["config-only-null"]).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("keeps the discovered provider package when the user only adds settings", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url === "https://models.dev/api.json") {
        return Response.json({ anthropic: { npm: "@ai-sdk/anthropic", models: {} } })
      }
      if (url.startsWith("http://cliproxy.test:8317/v1/models?")) {
        return Response.json({ models: [] })
      }
      return Response.json({
        data: [
          { id: "claude-sonnet-4-6", owned_by: "anthropic" },
          { id: "claude-opus-4-6", owned_by: "anthropic" },
        ],
      })
    }

    try {
      const plugin = await CLIProxyAPIPlugin(
        { client: { app: { log: async () => ({}) } } } as PluginInput,
        { baseURL: "http://cliproxy.test:8317" },
      )
      const config = {
        provider: {
          cliproxyapi: {
            models: {
              "claude-sonnet-4-6": { provider: { headers: { "X-Test": "1" } } },
              "claude-opus-4-6": { provider: {} },
            },
          },
        },
      } as Config

      await plugin.config?.(config)

      const models = config.provider?.cliproxyapi?.models
      expect(models?.["claude-sonnet-4-6"]?.provider).toEqual({
        npm: "@ai-sdk/anthropic",
        headers: { "X-Test": "1" },
      })
      // An empty provider object says nothing and must not erase the discovered one.
      expect(models?.["claude-opus-4-6"]?.provider).toEqual({ npm: "@ai-sdk/anthropic" })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("logs and rethrows an invalid baseURL", async () => {
    const logs: unknown[] = []
    const plugin = await CLIProxyAPIPlugin(
      {
        client: {
          app: {
            log: async (input: unknown) => {
              logs.push(input)
              return {}
            },
          },
        },
      } as PluginInput,
      { baseURL: "not a url" },
    )

    await expect(plugin.config?.({})).rejects.toThrow()
    expect(logs[0]).toMatchObject({ body: { level: "error" } })
  })
})
