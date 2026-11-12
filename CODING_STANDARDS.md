# CODING_STANDARDS.md

Consistency rules for this repo, derived from the code that already works here.
Consult the sections your change touches. The CI gate for every section is the
same.

## Verify

```sh
bun run check        # tsc --noEmit + bun test ./src + build; must be green
rg -n "128_000|32_000|4_096" src --glob '!src/shared.ts' --glob '!*.test.ts'
                     # limit literals live only in src/shared.ts
```

## 1. Trust-boundary parsing

Files in scope: `src/catalog.ts` (all `parse*`/`discover*`), `src/shared.ts`
(`readOptions`, the `isProper*` guards), `src/index.ts` (`mergeModels`),
`src/plugin-v2.ts` (`mergeV2Models`).

Rule: data from the network or user config never reaches a call site without a
type guard. An invalid field is skipped, not defaulted into place; throw only
when the whole response is unusable, and name what is missing.

Canonical: `src/catalog.ts:193-195` (`isRecord`), `:189-191`
(`isPositiveNumber`), `:49` (per-item guard), `:42,45` (whole-response throws).

| Don't | Do |
|---|---|
| `if (!item.id) ...` | `if (!isRecord(item) \|\| typeof item.id !== "string" \|\| item.id.trim() === "") return` — `src/catalog.ts:49` |
| `...userModel` (blind config spread) | `...definedKeys(userModel)` — `src/shared.ts:109-113` |
| `Number(x) > 0` on wire data | `isPositiveNumber(x)` — `src/catalog.ts:189-191` |

Verify: `bun test ./src` — `catalog.test.ts` "rejects malformed responses" and
"skips invalid limit values" stay green.

## 2. One limits resolver for both plugin versions

Files in scope: `src/shared.ts`, `src/index.ts`, `src/plugin-v2.ts`.

Rule: model limits resolve through `resolveModelLimits` (`src/shared.ts:70-79`).
The only numeric limit literals are `DEFAULT_CONTEXT_LIMIT` and
`DEFAULT_OUTPUT_LIMIT` (`src/shared.ts:17-20`). V1 (`src/index.ts:150`) and V2
(`src/plugin-v2.ts:105`) both call it — a limit change must never fork into a
per-version default.

Canonical: `src/shared.ts:70-79`.

Verify: the second command in the Verify block prints nothing.

## 3. User-config merge: proper values only

Files in scope: `src/index.ts` (`mergeModels`, `mergeDiscoveredModel`,
`:242-288`), `src/plugin-v2.ts` (`mergeV2Models`, `mergeV2Model`, `:123-152`).

Rules:

- A user value wins only after passing its guard: `isProperString`
  (`src/shared.ts:81-83`, non-empty after trim), `isProperBoolean` (`:85-87`),
  `isProperContextLimit`/`isProperOutputLimit` (`:89-98`, integer `> 0`).
- `limit` merges key-by-key (`src/index.ts:260`, `src/plugin-v2.ts:150`);
  user `0` means "use the default policy" and never overrides.
- `provider` is whole-override with `npm` backfilled from the discovered
  provider; an empty user provider keeps the discovered one
  (`src/index.ts:272-284`).
- `variants` and other nested objects are whole-override, via the
  `definedKeys` spread.
- Config-only models are preserved verbatim (`src/index.ts:250`,
  `src/plugin-v2.ts:132-137`); non-object user entries are ignored
  (`src/index.ts:242-257`, `src/plugin-v2.ts:137`).

Canonical: `mergeDiscoveredModel`, `src/index.ts:258-288`.

Verify: `index.test.ts` "merges user model overrides field by field" and
`plugin-v2.test.ts` `mergeV2Models` cases stay green.

## 4. Dual-surface parity (V1 + V2)

Files in scope: `src/index.ts` (V1 hooks), `src/plugin-v2.ts` (V2 `setup`),
`src/shared.ts`, `src/catalog.ts`.

Rule: behavior lives in `shared.ts`/`catalog.ts` and is mapped onto each
surface once; the two SDKs (`@opencode-ai/plugin`, `@opencode/plugin`) are
imported type-only, so the built plugin keeps no runtime dependency on either
(`src/plugin-v2.ts:1-12`). When a mapping differs only by package naming, use
the paired constants (`src/shared.ts:22-27`).

Canonical: anthropic routing — `V1_ANTHROPIC_PACKAGE` lands as `provider.npm`
(`src/index.ts:150`) and `V2_ANTHROPIC_PACKAGE` as `package`
(`src/plugin-v2.ts:87`), both decided by `isAnthropicRouted`
(`src/shared.ts:125-133`).

Verify: `bun run check` — the V1/V2 relational test in `index.test.ts` covers
it.

## 5. HTTP discovery and partial failure

Files in scope: `src/catalog.ts` `discover*`, `src/shared.ts`
(`discoverCatalog`, `discoverEffortLevels`), `src/index.ts:57-101`,
`src/plugin-v2.ts:164-211`.

Rules: every fetch uses `AbortSignal.timeout(input.timeoutMs)`
(`src/catalog.ts:161`) and a bearer header when a key exists; a non-ok
response throws `... failed with HTTP <status>: <detail>` with the detail
trimmed to 300 chars (`src/catalog.ts:164-183`); discovery warnings never
abort provider registration (`src/index.ts:66-74`, `src/plugin-v2.ts:175-177`);
a missing codex-client catalog degrades to an empty catalog, not an error
(`src/shared.ts:246-258`).

Verify: `catalog.test.ts` "reports an API error without hiding its useful
detail" and `plugin-v2.test.ts` setup-with-missing-catalog cases stay green.

## 6. Test style

Files in scope: `src/*.test.ts` (colocated, bun test).

Rules: fake the network through the `fetcher` override returning
`Response.json(...)` (`src/catalog.test.ts:51-59`); fake the V2 editor with the
calls-record pattern (`src/plugin-v2.test.ts:121-150`); every parse or merge
rule ships one positive case and one invalid-value case; a new catalog field
extends the fixture first, then the assertion.

Verify: `bun test ./src` (40+ tests, 0 fail).

## 7. House style

Double quotes, semicolons, 2-space indent, trailing commas on multiline
literals — match the file you edit. Comments state the why a reader cannot
see (`src/shared.ts:18-19`), never the what. No new dependency, CI step, or
test framework without an explicit ask.
