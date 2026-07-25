# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/yourcasualdev/opencode-cliproxyapi/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/yourcasualdev/opencode-cliproxyapi/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/yourcasualdev/opencode-cliproxyapi/releases/tag/v0.1.0
