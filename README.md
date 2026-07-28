# OpenCode CLIProxyAPI

[![CI](https://github.com/yourcasualdev/opencode-cliproxyapi/actions/workflows/ci.yml/badge.svg)](https://github.com/yourcasualdev/opencode-cliproxyapi/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/opencode-cliproxyapi)](https://www.npmjs.com/package/opencode-cliproxyapi)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Use every model exposed by [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
directly in [OpenCode](https://opencode.ai/).

The plugin discovers CLIProxyAPI's live `/v1/models` catalog whenever OpenCode
starts. Available models appear in the normal `/models` picker under
**CLIProxyAPI**. OpenCode Go models that expose Anthropic-compatible endpoints
are automatically routed through `/v1/messages` using live model metadata from
[models.dev](https://models.dev/); the remaining discovered models continue to
use the provider's configured default protocol. No model IDs are hard-coded.

## Quick start

You need OpenCode, a running CLIProxyAPI server, and one of its API keys.

### 1. Install

```bash
opencode plugin opencode-cliproxyapi --global
```

### 2. Save your connection

Open your global OpenCode config:

```text
~/.config/opencode/opencode.json
```

The installer may have created `opencode.jsonc` instead. Either filename works.
Configure the plugin entry with your persistent server URL and API key:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-cliproxyapi",
      {
        "baseURL": "http://your-server:8317",
        "apiKey": "your-cli-proxy-api-key"
      }
    ]
  ]
}
```

The URL may include `/v1`, but it is not required. If `baseURL` is omitted, the
plugin uses `http://localhost:8317/v1`.

Keep this global config private because it contains your API key. Do not copy
the connection into a project's `opencode.json` or commit it to a repository.

### 3. Verify

```bash
opencode models cliproxyapi
```

You should see models reported by your server:

```text
cliproxyapi/claude-sonnet-4-6
cliproxyapi/gpt-5.6-terra
cliproxyapi/gemini-3.1-pro-low
```

### 4. Select a model

Start OpenCode and run `/models`:

```bash
opencode
```

Choose **CLIProxyAPI**, select a model, and use OpenCode normally. Restart
OpenCode whenever the model catalog on CLIProxyAPI changes.

> This release stores the connection in OpenCode's global config instead of
> using the `/connect` screen. Model selection itself uses the standard
> `/models` experience.

## Configuration

The recommended configuration is the global plugin entry shown above:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-cliproxyapi",
      {
        "baseURL": "http://your-server:8317",
        "apiKey": "your-cli-proxy-api-key",
        "providerName": "My CLIProxyAPI"
      }
    ]
  ]
}
```

| Plugin option | Default | Purpose |
| --- | --- | --- |
| `baseURL` | `CLIPROXY_BASE_URL` or `http://localhost:8317/v1` | CLIProxyAPI URL |
| `apiKey` | `CLIPROXY_API_KEY` | CLIProxyAPI key |
| `providerID` | `cliproxyapi` | ID used in `provider/model` names |
| `providerName` | `CLIProxyAPI` | Name displayed in the model picker |
| `protocol` | `chat` | Default protocol: `chat` uses `/chat/completions`; `responses` uses `/responses`. Models marked as Anthropic-compatible by dynamic metadata override this per model. |
| `modelMetadataURL` | `https://models.dev/api.json` | Dynamic model-level protocol metadata. Set to `false` to disable enrichment and use only the default protocol. |
| `discoveryTimeoutMs` | `10000` | Startup model-discovery timeout |

If model metadata cannot be reached, the plugin logs a warning and keeps the
CLIProxyAPI-discovered models available with the configured default protocol.

### Optional environment variables

Environment variables remain available for containers, CI, or users who prefer
not to place a key in the config:

```bash
export CLIPROXY_BASE_URL="http://your-server:8317"
export CLIPROXY_API_KEY="your-cli-proxy-api-key"
```

Put these lines in your shell profile if you want them to persist. Explicit
plugin options in `opencode.json` take precedence over environment variables.

Existing `provider.cliproxyapi` settings are preserved, so individual models
can be customized:

```json
{
  "provider": {
    "cliproxyapi": {
      "models": {
        "gpt-5.6-terra": {
          "name": "Terra",
          "limit": {
            "context": 200000,
            "output": 65536
          }
        }
      }
    }
  }
}
```

## Troubleshooting

### `Missing API key`

Check that the global plugin entry contains a non-empty `apiKey`, then restart
OpenCode. If you chose environment variables instead, ensure
`CLIPROXY_API_KEY` is available to the process that starts OpenCode.

### No CLIProxyAPI models appear

First check the API directly:

```bash
curl -H "Authorization: Bearer your-cli-proxy-api-key" \
  "http://your-server:8317/v1/models"
```

Then restart OpenCode and run:

```bash
opencode models cliproxyapi
```

### Environment configuration works in one terminal but not another

Move the connection to the recommended global OpenCode config, or add the
environment variables to your shell profile.

## Development

```bash
git clone https://github.com/yourcasualdev/opencode-cliproxyapi.git
cd opencode-cliproxyapi
bun install
bun run check
```

The repository's `opencode.json` loads the local build for integration testing:

```bash
bun run build
export CLIPROXY_BASE_URL="http://your-server:8317"
export CLIPROXY_API_KEY="your-cli-proxy-api-key"
opencode models cliproxyapi
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

[MIT](LICENSE)
