# Contributing to ARP

Thanks for your interest in contributing! We welcome bug reports, feature ideas, documentation improvements, and code contributions.

## Ways to Contribute

- 🐛 [Report a bug](https://github.com/OpenInsightHQ/arp/issues/new?template=bug_report.md)
- 💡 [Suggest a feature](https://github.com/OpenInsightHQ/arp/issues/new?template=feature_request.md)
- 📖 Improve documentation (typos, unclear steps, missing guides)
- 🔧 Submit a pull request

## Getting Started

### 1. Fork & clone

```bash
git clone https://github.com/<your-username>/arp.git
cd arp
```

### 2. Set up the environment

Prerequisites: Node.js **v20.19.0+** and a running MongoDB instance.

```bash
cp .env.example .env          # then fill in MONGO_URI + secrets
npm run smart-reinstall       # install deps + build workspaces
```

See the [README](README.md#quick-start) for the full setup walkthrough, including
`JWT_SECRET` / `CREDS_KEY` generation and optional `librechat.yaml` configuration.

### 3. Create a branch

```bash
git checkout -b feat/my-feature   # or fix/my-bugfix
```

### 4. Make changes & verify

Before submitting, please verify:

- `npm run lint` passes
- `npm run build` completes without errors
- Affected workspace tests pass (`npm run test:all` or the workspace-specific test script)

### 5. Commit & push

Use clear commit messages, e.g. `fix(api): handle expired JWT refresh tokens`.

### 6. Open a pull request

Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md) and describe what changed and why.

## Code Guidelines

- **TypeScript / JavaScript**: follow the existing ESLint & Prettier configuration (`npm run lint`, `npm run format`)
- **Monorepo**: shared code belongs in `packages/*`, not duplicated between `api` and `client`
- **Commits**: Conventional Commits style — `feat:`, `fix:`, `docs:`, `chore:`
- **Docs**: user-facing documents in English

## Reporting Security Issues

Please **do not** open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0. See [LICENSE](LICENSE).
