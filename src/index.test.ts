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

      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe("http://cliproxy.test:8317/v1/models")
      expect(requests[0]?.headers.get("authorization")).toBe("Bearer secret")
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
})
