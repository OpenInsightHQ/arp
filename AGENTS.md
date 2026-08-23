# LibreChat

## Project Overview

LibreChat is a monorepo with the following key workspaces:

| Workspace | Language | Side | Dependency | Purpose |
|---|---|---|---|---|
| `/api` | JS (legacy) | Backend | `packages/api`, `packages/data-schemas`, `packages/data-provider`, `@librechat/agents` | Express server — minimize changes here |
| `/packages/api` | **TypeScript** | Backend | `packages/data-schemas`, `packages/data-provider` | New backend code lives here (TS only, consumed by `/api`) |
| `/packages/data-schemas` | TypeScript | Backend | `packages/data-provider` | Database models/schemas, shareable across backend projects |
| `/packages/data-provider` | TypeScript | Shared | — | Shared API types, endpoints, data-service — used by both frontend and backend |
| `/client` | TypeScript/React | Frontend | `packages/data-provider`, `packages/client` | Frontend SPA |
| `/packages/client` | TypeScript | Frontend | `packages/data-provider` | Shared frontend utilities |

---

## Workspace Boundaries

- **All new backend code must be TypeScript** in `/packages/api`.
- Keep `/api` changes to the absolute minimum (thin JS wrappers calling into `/packages/api`).
- Database-specific shared logic goes in `/packages/data-schemas`.
- Frontend/backend shared API logic (endpoints, types, data-service) goes in `/packages/data-provider`.
- Build data-provider from project root: `npm run build:data-provider`.

---

## Code Style

### Structure and Clarity

- **Never-nesting**: early returns, flat code, minimal indentation. Break complex operations into well-named helpers.
- **Functional first**: pure functions, immutable data, `map`/`filter`/`reduce` over imperative loops. Only reach for OOP when it clearly improves domain modeling or state encapsulation.
- **No dynamic imports** unless absolutely necessary.

### DRY

- Extract repeated logic into utility functions.
- Reusable hooks / higher-order components for UI patterns.
- Parameterized helpers instead of near-duplicate functions.
- Constants for repeated values; configuration objects over duplicated init code.
- Shared validators, centralized error handling, single source of truth for business rules.
- Shared typing system with interfaces/types extending common base definitions.
- Abstraction layers for external API interactions.

### Iteration and Performance

- **Minimize looping** — especially over shared data structures like message arrays, which are iterated frequently throughout the codebase. Every additional pass adds up at scale.
- Consolidate sequential O(n) operations into a single pass whenever possible; never loop over the same collection twice if the work can be combined.
- Choose data structures that reduce the need to iterate (e.g., `Map`/`Set` for lookups instead of `Array.find`/`Array.includes`).
- Avoid unnecessary object creation; consider space-time tradeoffs.
- Prevent memory leaks: careful with closures, dispose resources/event listeners, no circular references.

### Type Safety

- **Never use `any`**. Explicit types for all parameters, return values, and variables.
- **Limit `unknown`** — avoid `unknown`, `Record<string, unknown>`, and `as unknown as T` assertions. A `Record<string, unknown>` almost always signals a missing explicit type definition.
- **Don't duplicate types** — before defining a new type, check whether it already exists in the project (especially `packages/data-provider`). Reuse and extend existing types rather than creating redundant definitions.
- Use union types, generics, and interfaces appropriately.
- All TypeScript and ESLint warnings/errors must be addressed — do not leave unresolved diagnostics.

### Comments and Documentation

- Write self-documenting code; no inline comments narrating what code does.
- JSDoc only for complex/non-obvious logic or intellisense on public APIs.
- Single-line JSDoc for brief docs, multi-line for complex cases.
- Avoid standalone `//` comments unless absolutely necessary.

### Import Order

Imports are organized into three sections:

1. **Package imports** — sorted shortest to longest line length (`react` always first).
2. **`import type` imports** — sorted longest to shortest (package types first, then local types; length resets between sub-groups).
3. **Local/project imports** — sorted longest to shortest.

Multi-line imports count total character length across all lines. Consolidate value imports from the same module. Always use standalone `import type { ... }` — never inline `type` inside value imports.

### JS/TS Loop Preferences

- **Limit looping as much as possible.** Prefer single-pass transformations and avoid re-iterating the same data.
- `for (let i = 0; ...)` for performance-critical or index-dependent operations.
- `for...of` for simple array iteration.
- `for...in` only for object property enumeration.

---

## Frontend Rules (`client/src/**/*`)

### Localization

- Every page or component change must explicitly consider localization before implementation and review.
- All user-facing text, including labels, tooltips, titles, placeholders, validation messages, and accessibility text, must use `useLocalize()`; never hardcode display text in components.
- Add the English source key to `client/src/locales/en/translation.json`. When a feature ships with product-maintained translations, update those locale files in the same change; other languages remain automated externally.
- Verify new or changed UI in both English and Simplified Chinese before deployment.
- Semantic key prefixes: `com_ui_`, `com_assistants_`, etc.

### Components

- TypeScript for all React components with proper type imports.
- Semantic HTML with ARIA labels (`role`, `aria-label`) for accessibility.
- Group related components in feature directories (e.g., `SidePanel/Memories/`).
- Use index files for clean exports.

### Data Management

- Feature hooks: `client/src/data-provider/[Feature]/queries.ts` → `[Feature]/index.ts` → `client/src/data-provider/index.ts`.
- React Query (`@tanstack/react-query`) for all API interactions; proper query invalidation on mutations.
- QueryKeys and MutationKeys in `packages/data-provider/src/keys.ts`.

### Data-Provider Integration

- Endpoints: `packages/data-provider/src/api-endpoints.ts`
- Data service: `packages/data-provider/src/data-service.ts`
- Types: `packages/data-provider/src/types/queries.ts`
- Use `encodeURIComponent` for dynamic URL parameters.

### Performance

- Prioritize memory and speed efficiency at scale.
- Cursor pagination for large datasets.
- Proper dependency arrays to avoid unnecessary re-renders.
- Leverage React Query caching and background refetching.

---

## Development Commands

| Command | Purpose |
|---|---|
| `npm run smart-reinstall` | Install deps (if lockfile changed) + build via Turborepo |
| `npm run reinstall` | Clean install — wipe `node_modules` and reinstall from scratch |
| `npm run backend` | Start the backend server |
| `npm run backend:dev` | Start backend with file watching (development) |
| `npm run build` | Build all compiled code via Turborepo (parallel, cached) |
| `npm run frontend` | Build all compiled code sequentially (legacy fallback) |
| `npm run frontend:dev` | Start frontend dev server with HMR (port 3090, requires backend running) |
| `npm run build:data-provider` | Rebuild `packages/data-provider` after changes |

- Node.js: v20.19.0+ or ^22.12.0 or >= 23.0.0
- Database: MongoDB
- Backend runs on `http://localhost:3080/`; frontend dev server on `http://localhost:3090/`

---

## Testing

- Framework: **Jest**, run per-workspace.
- Run tests from their workspace directory: `cd api && npx jest <pattern>`, `cd packages/api && npx jest <pattern>`, etc.
- Frontend tests: `__tests__` directories alongside components; use `test/layout-test-utils` for rendering.
- Cover loading, success, and error states for UI/data flows.
- Mock data-provider hooks and external dependencies.

---

## Formatting

Fix all formatting lint errors (trailing spaces, tabs, newlines, indentation) using auto-fix when available. All TypeScript/ESLint warnings and errors **must** be resolved.

---

## PI Agent Architecture (One Pi)

PI ("One Pi") is a custom endpoint defined in `librechat.yaml` with `baseURL: ${ARP_HOST}/api/pi`. The PI backend exposes two interfaces:

1. **OpenAI-compatible** — `${ARP_HOST}/api/pi/chat/completions` (custom endpoint, OpenAI format)
2. **PI-native** — `${PI_HOST}/prompt` (SSE stream, accepts `{message, agentId, sessionId, systemPrompt, ...}`)

### Two Request Paths

| Path | Route | Controller | System Prompt Source |
|---|---|---|---|
| **Frontend UI chat** | `/api/agents/chat/pi` → custom endpoint `baseURL` | `piChatCompletionsController` (OpenAI-compat) | PI backend injects its own; LibreChat passes `additional_instructions` |
| **Direct PI routes** | `/api/pi/prompt`, `/api/pi/chat/completions` | `piChatCompletionsController` or SSE forward | `getPiSystemPrompt(lang)` base prompt (`pi.system` from DB); `<available_prompts>` and user memories are appended by pi itself |

### Frontend Chat Flow (`/api/agents/chat/pi`)

```
Browser → /api/agents/chat/pi → initializeAgent (packages/api/src/agents/initialize.ts)
  → custom endpoint forwards to ${ARP_HOST}/api/pi/chat/completions
  → piChatCompletionsController (api/server/controllers/pi/chatCompletions.js)
  → fetch ${PI_HOST}/prompt with { message: userMessage, systemPrompt: getPiSystemPrompt(lang) }
```

- PI agent record has **empty instructions** (`provider` shows as `openAI` due to custom endpoint override).
- `buildPiForwardHeaders` (`packages/api/src/endpoints/custom/piRequestHeaders.ts`) adds `X-Conversation-Id` and `Accept-Language` headers to the forwarded request.
- `getPiSystemPrompt(lang)` (`packages/api/src/prompts/systemPromptService.ts`) reads `pi.system` from the `systemprompts` collection and resolves `{{lang}}`.
- **User-context appending lives in pi** (pi-agent-github): pi reads `systemprompts` (ACL VIEW on `resourceType: systemPrompt`, `piPrompt: true`) for `<available_prompts>` and `memoryentries` (role MEMORIES USE+READ + personalization opt-out) for the `[用户长期记忆]` block, and injects the `read_memory_detail` / `read_memory_conversation` tools. arp no longer appends these.
- System prompt seeding is handled by the DMP project (`init-data/system-prompts/*.yaml`), not by LibreChat.
- **`message` field** contains only the current user message (no conversation history injection).

### Key Files

| File | Purpose |
|---|---|
| `packages/api/src/agents/initialize.ts` | Agent initialization; PI `additional_instructions` injection |
| `packages/api/src/prompts/systemPromptService.ts` | `getPiSystemPrompt(lang)` — fetches `pi.system` from DB |
| `packages/api/src/endpoints/custom/piRequestHeaders.ts` | `buildPiForwardHeaders` — headers forwarded to PI backend |
| `packages/api/src/endpoints/custom/initialize.ts` | Custom endpoint init; calls `buildPiForwardHeaders` |
| `api/server/controllers/pi/chatCompletions.js` | PI OpenAI-compatible controller (stateless translation layer) |
| `api/server/routes/pi.js` | PI routes (`/prompt`, `/chat/completions`, files) |

### Build Reminder

`/api` (JS backend) loads `@librechat/api` from compiled `dist/`. After changing TypeScript in `packages/api/`, rebuild before testing:

```bash
cd packages/api && npm run build
```

`nodemon` ignores `packages/` — it will NOT auto-restart on `packages/api` changes. Manual backend restart is required.
