import { describe, expect, test } from "bun:test"
import type { Config, PluginInput } from "@opencode-ai/plugin"
import { CLIProxyAPIPlugin } from "./index.js"

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
          low: { reasoningEffort: "low" },
          medium: { reasoningEffort: "medium" },
          high: { reasoningEffort: "high" },
          xhigh: { reasoningEffort: "xhigh" },
          max: { reasoningEffort: "max" },
        },
      })
      expect(models?.["gemini-3.1-pro-low"]).toMatchObject({
        reasoning: true,
        options: { reasoningEffort: "low" },
        variants: {
          low: { reasoningEffort: "low" },
          high: { reasoningEffort: "high" },
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
})
