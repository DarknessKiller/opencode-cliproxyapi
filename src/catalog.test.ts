import { describe, expect, test } from "bun:test"
import {
  discoverModelProtocols,
  discoverModels,
  discoverReasoningEfforts,
  normalizeBaseURL,
  parseCatalog,
  parseModelProtocolCatalog,
  parseReasoningEffortCatalog,
} from "./catalog.js"
import { resolveModelLimits } from "./shared.js"

describe("normalizeBaseURL", () => {
  test.each([
    ["http://cliproxy.test:8317", "http://cliproxy.test:8317/v1"],
    ["http://cliproxy.test:8317/", "http://cliproxy.test:8317/v1"],
    ["http://cliproxy.test:8317/v1", "http://cliproxy.test:8317/v1"],
    ["https://example.com/proxy/", "https://example.com/proxy/v1"],
  ])("%s becomes %s", (input, expected) => {
    expect(normalizeBaseURL(input)).toBe(expected)
  })
})

describe("parseCatalog", () => {
  test("returns unique valid models", () => {
    expect(
      parseCatalog({
        object: "list",
        data: [
          { id: "gpt-5.6-terra", object: "model", owned_by: "openai" },
          { id: "claude-sonnet-4-6", object: "model" },
          { id: "gpt-5.6-terra", object: "model" },
          { id: "" },
          null,
        ],
      }),
    ).toEqual([
      { id: "gpt-5.6-terra", ownedBy: "openai" },
      { id: "claude-sonnet-4-6" },
    ])
  })

  test("rejects malformed responses", () => {
    expect(() => parseCatalog({ data: {} })).toThrow("missing the data array")
    expect(() => parseCatalog({ data: [] })).toThrow("no usable models")
  })
})

describe("discoverModels", () => {
  test("uses bearer authentication", async () => {
    let authorization = ""
    const models = await discoverModels({
      baseURL: "http://cliproxy.test/v1",
      apiKey: "secret",
      timeoutMs: 1_000,
      fetcher: async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? ""
        return Response.json({ data: [{ id: "gemini-3.1-pro-low" }] })
      },
    })

    expect(authorization).toBe("Bearer secret")
    expect(models).toEqual([{ id: "gemini-3.1-pro-low" }])
  })

  test("reports an API error without hiding its useful detail", async () => {
    await expect(
      discoverModels({
        baseURL: "http://cliproxy.test/v1",
        timeoutMs: 1_000,
        fetcher: async () => Response.json({ error: "Missing API key" }, { status: 401 }),
      }),
    ).rejects.toThrow('HTTP 401: {"error":"Missing API key"}')
  })
})

describe("parseReasoningEffortCatalog", () => {
  test("indexes per-model reasoning levels from the codex-client catalog", () => {
    expect(
      parseReasoningEffortCatalog({
        models: [
          {
            slug: "gpt-5.6-terra",
            supported_reasoning_levels: [
              { effort: "none" },
              { effort: "low", description: "Low effort" },
              { effort: "low" },
              { effort: "high" },
            ],
            default_reasoning_level: "low",
          },
          {
            slug: "gemini-3.1-pro-low",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
          },
          { slug: "no-levels", supported_reasoning_levels: [] },
          { id: "no-slug", supported_reasoning_levels: [{ effort: "high" }] },
          null,
        ],
      }),
    ).toEqual({
      "gpt-5.6-terra": { levels: ["none", "low", "high"], defaultLevel: "low" },
      "gemini-3.1-pro-low": { levels: ["low", "high"] },
      "no-levels": { levels: [] },
    })
  })

  test("returns an empty catalog when the server lacks the codex-client view", () => {
    expect(parseReasoningEffortCatalog({ data: [{ id: "gpt-5.6-terra" }] })).toEqual({})
    expect(parseReasoningEffortCatalog({ models: [] })).toEqual({})
    expect(parseReasoningEffortCatalog([])).toEqual({})
  })

  test("parses context and output limits", () => {
    expect(
      parseReasoningEffortCatalog({
        models: [
          {
            slug: "both-windows",
            context_window: 200_000,
            max_context_window: 400_000,
            max_tokens: 64_000,
          },
          { slug: "max-context-only", max_context_window: 1_000_000, max_tokens: 8_000 },
          { slug: "fallback-context", context_window: 0, max_context_window: 100_000 },
        ],
      }),
    ).toEqual({
      "both-windows": { limit: { context: 200_000, output: 64_000 } },
      "max-context-only": { limit: { context: 1_000_000, output: 8_000 } },
      "fallback-context": { limit: { context: 100_000 } },
    })
  })

  test("skips invalid limit values", () => {
    expect(
      parseReasoningEffortCatalog({
        models: [
          {
            slug: "invalid-limits",
            context_window: -1,
            max_context_window: Number.POSITIVE_INFINITY,
            max_tokens: Number.NaN,
            max_output_tokens: 32_000,
          },
          { slug: "zero-and-string", context_window: 0, max_tokens: "8000" },
        ],
      }),
    ).toEqual({ "invalid-limits": {}, "zero-and-string": {} })
  })
})

describe("discoverReasoningEfforts", () => {
  test("requests the codex-client catalog and indexes effort levels", async () => {
    let requestedURL = ""
    let authorization = ""
    const catalog = await discoverReasoningEfforts({
      baseURL: "http://cliproxy.test/v1",
      apiKey: "secret",
      timeoutMs: 1_000,
      fetcher: async (input, init) => {
        requestedURL = String(input)
        authorization = new Headers(init?.headers).get("authorization") ?? ""
        return Response.json({
          models: [
            {
              slug: "gpt-5.6-terra",
              supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
              default_reasoning_level: "low",
            },
          ],
        })
      },
    })

    expect(requestedURL).toBe("http://cliproxy.test/v1/models?client_version=1.0.0")
    expect(authorization).toBe("Bearer secret")
    expect(catalog).toEqual({
      "gpt-5.6-terra": { levels: ["low", "high"], defaultLevel: "low" },
    })
  })

  test("reports an API error", async () => {
    await expect(
      discoverReasoningEfforts({
        baseURL: "http://cliproxy.test/v1",
        timeoutMs: 1_000,
        fetcher: async () => Response.json({ error: "boom" }, { status: 500 }),
      }),
    ).rejects.toThrow('HTTP 500: {"error":"boom"}')
  })
})

describe("parseModelProtocolCatalog", () => {
  test("indexes provider defaults and model-level SDK overrides", () => {
    expect(
      parseModelProtocolCatalog({
        acme: {
          npm: "@ai-sdk/openai-compatible",
          models: {
            "chat-model": {},
            "messages-model": {
              provider: {
                npm: "@ai-sdk/anthropic",
              },
            },
          },
        },
        malformed: {
          models: [],
        },
      }),
    ).toEqual({
      acme: {
        npm: "@ai-sdk/openai-compatible",
        models: {
          "messages-model": "@ai-sdk/anthropic",
        },
      },
    })
  })

  test("rejects a malformed catalog", () => {
    expect(() => parseModelProtocolCatalog([])).toThrow("non-object catalog")
  })
})

describe("discoverModelProtocols", () => {
  test("fetches protocol metadata from the configured URL", async () => {
    let requestedURL = ""
    const catalog = await discoverModelProtocols({
      url: "https://metadata.test/models.json",
      timeoutMs: 1_000,
      fetcher: async (input) => {
        requestedURL = String(input)
        return Response.json({
          acme: {
            models: {
              "messages-model": {
                provider: {
                  npm: "@ai-sdk/anthropic",
                },
              },
            },
          },
        })
      },
    })

    expect(requestedURL).toBe("https://metadata.test/models.json")
    expect(catalog).toEqual({
      acme: {
        models: {
          "messages-model": "@ai-sdk/anthropic",
        },
      },
    })
  })
})

describe("resolveModelLimits", () => {
  test("falls back to the default limits", () => {
    expect(resolveModelLimits({ id: "gpt-5.6-terra" }, {})).toEqual({
      context: 128_000,
      output: 32_000,
    })
    expect(
      resolveModelLimits({ id: "gpt-5.6-terra" }, { "gpt-5.6-terra": { levels: ["low"] } }),
    ).toEqual({ context: 128_000, output: 32_000 })
  })

  test("prefers the catalog limits", () => {
    expect(
      resolveModelLimits(
        { id: "gpt-5.6-terra" },
        { "gpt-5.6-terra": { limit: { context: 400_000, output: 128_000 } } },
      ),
    ).toEqual({ context: 400_000, output: 128_000 })
    expect(
      resolveModelLimits(
        { id: "gpt-5.6-terra" },
        { "gpt-5.6-terra": { limit: { output: 16_000 } } },
      ),
    ).toEqual({ context: 128_000, output: 16_000 })
  })
})
