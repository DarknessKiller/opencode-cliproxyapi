# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Stop OpenCode from adding its own default reasoning efforts on top of the
  server-reported ones. OpenCode merges per-model default variants
  (e.g. `medium` for OpenAI-compatible models) with the plugin's variants, so
  models configured on CLIProxyAPI with only `low`/`high`/`max` used to show
  `low`/`medium`/`high`/`max` in the picker. Unreported default efforts are
  now disabled and the picker shows exactly the server-supported set.

## [0.2.0] - 2026-09-09

### Added

- Auto-configure reasoning effort per model from CLIProxyAPI's own model
  catalog. Models the server reports with supported reasoning levels are
  marked as reasoning models, get their default effort configured, and expose
  every supported effort as an OpenCode model variant for the variant-cycle
  keybind.
- Query CLIProxyAPI's codex-client model catalog (`/v1/models?client_version=`)
  to discover per-model reasoning levels at startup.

### Changed

- A model's `reasoning` flag now prefers CLIProxyAPI's reported effort levels
  over the previous id-based heuristic; the heuristic remains the fallback for
  servers that do not report levels.

## [0.1.2] - 2026-07-28

### Fixed

- Dynamically route models with Anthropic protocol metadata through
  `/v1/messages` instead of OpenAI-compatible chat completions, without
  hard-coding model IDs.
- Preserve discovered model protocol metadata when users customize individual
  model settings.

## [0.1.1] - 2026-07-25

### Changed

- Made persistent global OpenCode configuration the recommended setup flow.
- Moved temporary environment-variable setup to an optional alternative.
- Clarified API-key handling and troubleshooting.

## [0.1.0] - 2026-07-25

### Added

- Dynamic model discovery from CLIProxyAPI's `/v1/models` endpoint.
- OpenCode provider configuration for OpenAI-compatible chat completions.
- Custom server URL and API key support through environment variables or
  plugin options.
- Automatic model names and capability hints in OpenCode's model picker.
- Local plugin and npm package installation flows.

[Unreleased]: https://github.com/DarknessKiller/opencode-cliproxyapi/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/DarknessKiller/opencode-cliproxyapi/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/DarknessKiller/opencode-cliproxyapi/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/DarknessKiller/opencode-cliproxyapi/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/DarknessKiller/opencode-cliproxyapi/releases/tag/v0.1.0
