import { describe, expect, test } from "bun:test"
import { discoverModels, normalizeBaseURL, parseCatalog } from "./catalog.js"

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
