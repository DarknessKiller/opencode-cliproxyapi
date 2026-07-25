# OpenCode CLIProxyAPI

[![CI](https://github.com/yourcasualdev/opencode-cliproxyapi/actions/workflows/ci.yml/badge.svg)](https://github.com/yourcasualdev/opencode-cliproxyapi/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/opencode-cliproxyapi)](https://www.npmjs.com/package/opencode-cliproxyapi)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Use every model exposed by [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
directly in [OpenCode](https://opencode.ai/).

The plugin discovers CLIProxyAPI's live `/v1/models` catalog whenever OpenCode
starts. Available models appear in the normal `/models` picker under
**CLIProxyAPI**, with no hard-coded model list to maintain.

## Quick start

You need OpenCode, a running CLIProxyAPI server, and one of its API keys.

### 1. Install

```bash
opencode plugin opencode-cliproxyapi --global
```

### 2. Set your connection

macOS or Linux:

```bash
export CLIPROXY_BASE_URL="http://your-server:8317"
export CLIPROXY_API_KEY="your-cli-proxy-api-key"
```

Windows PowerShell:

```powershell
$env:CLIPROXY_BASE_URL = "http://your-server:8317"
$env:CLIPROXY_API_KEY = "your-cli-proxy-api-key"
```

The URL may include `/v1`, but it is not required. If the URL is omitted, the
plugin uses `http://localhost:8317/v1`.

These variables must be available to the process that starts OpenCode. Add them
to your shell profile if you want them set in every new terminal.

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

> This release uses environment variables instead of OpenCode's `/connect`
> screen. Model selection itself uses the standard `/models` experience.

## Configuration

The environment variables are the simplest and safest configuration:

| Variable | Required | Default |
| --- | --- | --- |
| `CLIPROXY_API_KEY` | Yes, when the server requires authentication | None |
| `CLIPROXY_BASE_URL` | No | `http://localhost:8317/v1` |

Plugin options can be set in `opencode.json` when more control is needed:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-cliproxyapi",
      {
        "baseURL": "http://your-server:8317",
        "providerName": "My CLIProxyAPI"
      }
    ]
  ]
}
```

Keep the API key in `CLIPROXY_API_KEY`; do not commit it to
`opencode.json`.

| Plugin option | Default | Purpose |
| --- | --- | --- |
| `baseURL` | `CLIPROXY_BASE_URL` or `http://localhost:8317/v1` | CLIProxyAPI URL |
| `apiKey` | `CLIPROXY_API_KEY` | API key; prefer the environment variable |
| `providerID` | `cliproxyapi` | ID used in `provider/model` names |
| `providerName` | `CLIProxyAPI` | Name displayed in the model picker |
| `protocol` | `chat` | `chat` uses `/chat/completions`; `responses` uses `/responses` |
| `discoveryTimeoutMs` | `10000` | Startup model-discovery timeout |

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

Set `CLIPROXY_API_KEY` in the same terminal that starts OpenCode:

```bash
export CLIPROXY_API_KEY="your-cli-proxy-api-key"
```

### No CLIProxyAPI models appear

First check the API directly. If your base URL does not include `/v1`:

```bash
curl -H "Authorization: Bearer $CLIPROXY_API_KEY" \
  "${CLIPROXY_BASE_URL%/}/v1/models"
```

If it already ends in `/v1`:

```bash
curl -H "Authorization: Bearer $CLIPROXY_API_KEY" \
  "${CLIPROXY_BASE_URL%/}/models"
```

Then restart OpenCode and run:

```bash
opencode models cliproxyapi
```

### It works in one terminal but not another

The second terminal or desktop launcher may not have the environment
variables. Start OpenCode from the terminal where they are set, or configure
the launcher to provide them.

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
