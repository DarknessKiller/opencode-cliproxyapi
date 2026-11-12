CODING_STANDARDS.md — repo consistency rules: trust-boundary parsing guards, the shared limits resolver, user-config merge, V1/V2 parity, HTTP discovery, test style. Read the sections your change touches before editing.

## Default routine

1. Read the CODING_STANDARDS.md sections matching your change area, and load any vendored skill whose trigger matches (see Vendored skills).
2. Locate code with CodeGraph (below) before grepping or opening files.
3. Implement, then run `bun run check` — tsc, tests, and build all green.
4. New parse or merge rule: ship a positive case and an invalid-value case.
5. Hand off only after re-checking each changed line against its standards section, and `rg -n "128_000|32_000|4_096" src --glob '!src/shared.ts' --glob '!*.test.ts'` prints nothing.

## Vendored skills (load by trigger, from .agents/skills/)

- **typescript** — load when touching .ts/.tsx type definitions or tsconfig, fixing type errors (TS2322, TS2339), or optimizing tsc/async performance.

It carries upstream provenance in its SKILL.md frontmatter; where a skill conflicts with CODING_STANDARDS.md, the standards win.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, run `codegraph init` at the repo root first, then work with CodeGraph as above.
<!-- CODEGRAPH_END -->
