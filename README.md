<h1 align="center">OpenInsight</h1>

<p align="center">
  An enterprise-grade, self-hosted AI conversation platform.<br/>
  Built on top of <a href="https://github.com/danny-avila/LibreChat">LibreChat</a>.
</p>

<p align="center">
  <a href="https://github.com/OpenInsightHQ/arp/blob/main/LICENSE">
    <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  </a>
  <a href="https://nodejs.org">
    <img alt="Node.js" src="https://img.shields.io/badge/node-%E2%89%A520.19-339933.svg?logo=node.js&logoColor=white">
  </a>
  <a href="https://github.com/OpenInsightHQ/arp/releases">
    <img alt="Releases" src="https://img.shields.io/github/v/release/OpenInsightHQ/arp?include_prereleases">
  </a>
</p>

---

## Overview

OpenInsight is a self-hosted, multi-user AI chat platform that unifies many model
providers (OpenAI, Anthropic, Google, Azure, Bedrock, and any OpenAI-compatible
endpoint) behind a single, polished web UI. It adds an enterprise integration and
customization layer on top of [LibreChat](https://github.com/danny-avila/LibreChat):

- **DMP integration** — connects to the Data Management Platform for user lookup,
  agent context, and an MCP tool bridge.
- **Automatic SSO** — JWT-based single sign-on from an external auth cookie, with
  configurable claim-to-user mapping.
- **UI watermarks** — configurable chat & artifact watermarks (per-department /
  per-user templates, opacity, density, rotation).
- **Branded artifacts** — generative UI with Sandpack-backed previews, configurable
  CDN sources, and CSP allow-lists.
- **Custom endpoints presets** — opinionated defaults for GLM, Qwen, DeepSeek, Kimi,
  Tencent LKEAP, and more.
- **Code Interpreter, Agents, MCP, Web Search, Image Generation** — inherited from
  upstream LibreChat.

> ℹ️ This project is a fork of [LibreChat](https://github.com/danny-avila/LibreChat)
> by Danny Avila and contributors. All upstream features are available here; see the
> [LibreChat docs](https://www.librechat.ai/docs/) for general usage.

---

## Features

- **Multi-provider chat**: OpenAI, Anthropic, Google, Azure, AWS Bedrock, Vertex AI,
  and any OpenAI-compatible endpoint (Ollama, DeepSeek, GLM, Qwen, Kimi, …).
- **Agents & MCP**: no-code custom agents, Model Context Protocol tool servers,
  agent marketplace, and remote agent sharing.
- **Generative UI / Artifacts**: React, HTML, and Mermaid diagrams rendered in chat.
- **Code Interpreter API**: sandboxed Python, Node, Go, C/C++, Java, Rust, and more.
- **Multimodal & files**: image understanding, file chat, SharePoint picker.
- **Multilingual UI** with reasoning-model support.
- **Multi-user, secure access**: OAuth2, OpenID, SAML, LDAP, email login, plus the
  OpenInsight automatic SSO layer.
- **Resumable streams**, conversation search, presets, message branching, import/export.

---

## Quick Start

### Prerequisites

- Node.js **v20.19.0+** / **^22.12.0** / **>= 23.0.0**
- MongoDB
- (Optional) Meilisearch, Redis

### 1. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in at least:

- `MONGO_URI`
- `JWT_SECRET`, `JWT_REFRESH_SECRET` (generate with
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
- `CREDS_KEY`, `CREDS_IV` (see `.env.example` for generation commands)
- Any model-provider keys you plan to use

OpenInsight-specific variables (DMP, AUTO_SSO, WATERMARK, SANDPACK, CSP, PI, …) are
documented in the **OpenInsight Extensions** section at the bottom of `.env.example`.

### 2. Configure endpoints (optional)

```bash
cp librechat.example.yaml librechat.yaml
```

Edit `librechat.yaml` to define custom endpoints, MCP servers, and interface options.
See `librechat.example.yaml` and the
[LibreChat yaml docs](https://www.librechat.ai/docs/configuration/librechat_yaml).

### 3. Install & run

```bash
npm run smart-reinstall   # install deps + build workspaces
npm run backend           # start the API server on :3080
```

In a second terminal:

```bash
npm run frontend:dev      # Vite dev server on :3090
```

Or run everything with Docker:

```bash
docker compose up -d
```

---

## Development

| Command | Purpose |
| --- | --- |
| `npm run backend:dev` | Start backend with file watching |
| `npm run frontend:dev` | Start frontend dev server (HMR) |
| `npm run build` | Build all workspaces via Turborepo |
| `npm run build:data-provider` | Rebuild `packages/data-provider` after edits |
| `npm run lint` / `npm run lint:fix` | ESLint |
| `npm run format` | Prettier |
| `npm run test:all` | Run all workspace tests |

Monorepo layout: `/api` (legacy JS backend), `/packages/api` (new TS backend),
`/packages/data-schemas`, `/packages/data-provider` (shared), `/client` (frontend),
`/packages/client` (shared frontend utils).

---

## Contributing

Contributions, bug reports, and feature requests are welcome — please open an issue
first to discuss any non-trivial change. See
[`CONTRIBUTING.md`](.github/CONTRIBUTING.md) and
[`SECURITY.md`](.github/SECURITY.md) for policies.

---

## Acknowledgements

OpenInsight would not exist without the outstanding work of
**[Danny Avila](https://github.com/danny-avila)** and the
**[LibreChat](https://github.com/danny-avila/LibreChat)** contributors. This project
forks and extends LibreChat under the terms of the MIT license.

---

## License

Released under the [MIT License](LICENSE).
