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

      expect(requests).toHaveLength(2)
      const modelRequest = requests.find(
        (request) => request.url === "http://cliproxy.test:8317/v1/models",
      )
      expect(modelRequest?.headers.get("authorization")).toBe("Bearer secret")
      expect(requests.some((request) => request.url === "https://models.dev/api.json")).toBe(true)
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
})
