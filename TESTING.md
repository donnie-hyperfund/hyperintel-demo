# Testing

## Framework

**Vitest v4** — fast, native TypeScript, Jest-compatible API, workspace-based multi-project setup.

## File Naming Convention

| Pattern | Type | Purpose |
|---------|------|---------|
| `*.test.ts` | Unit | Isolated tests, mocked dependencies |
| `*.integration.test.ts` | Integration | Complex flows, multiple real components wired together |
| `*.e2e.test.ts` | E2E | Endpoint tests (Next.js API routes, real HTTP requests) |

## Where Tests Live

### Decision tree

1. **Testing a specific source file?** → Co-locate next to it
2. **Cross-module test, single file, no scenario?** → `tests/integration/`
3. **Complex multi-step business scenario?** → `tests/scenarios/<name>/`
4. **Shared test utilities / factories / mocks?** → `tests/helpers/`

### Co-located (next to source file)

Default for most tests — anything with a 1:1 relationship to a source file.

```
app/api/projects/
├── route.ts
└── route.e2e.test.ts              # e2e: GET /api/projects

common/ai/inference/
├── openai.ts
├── openai.test.ts                 # unit: normalizer logic
└── openai.integration.test.ts     # integration: hits real API
```

### `tests/integration/` — standalone cross-module tests

Single-file integration tests that span multiple modules but don't belong next to any one source file.

### `tests/scenarios/<name>/` — complex business scenarios

Multi-step flows with multiple test types grouped by scenario instead of scattered across folders.

```
tests/scenarios/document-upload/
├── parse-and-embed.integration.test.ts
├── upload-api.e2e.test.ts
├── retrieval.integration.test.ts
└── _helpers.ts
```

### `tests/helpers/` — shared test utilities

Factories, mock builders, common setup used across multiple test files.

## Commands

All commands default to **watch mode**. Append `--run` to exit after completion (CI).

```bash
pnpm test                    # everything except integration, watch mode
pnpm test --run              # everything except integration, exits (CI)
```

### By type

```bash
pnpm test:unit               # all unit tests across all projects
pnpm test:e2e                # Next.js endpoint tests
pnpm test:integration        # all integration tests across all projects
```

### App (Next.js frontend + lib/)

```bash
pnpm test:app                # unit + e2e (no integration)
pnpm test:app:unit           # unit only
pnpm test:app:e2e            # e2e only
pnpm test:app:integration    # integration only
```

### Common (git submodule: common/)

```bash
pnpm test:common             # unit + integration
pnpm test:common:unit        # unit only
pnpm test:common:integration # integration only
```

### Workers

```bash
pnpm test:workers            # all workers including _common
pnpm test:workers:common     # workers/_common only
```

Workers don't have a unit/integration split. To test a specific worker, `cd` into its directory and run `pnpm test`.

### Scenarios

```bash
pnpm test:scenario                    # all scenarios (unit + e2e + integration), exits
pnpm test:scenario document-deletion  # specific scenario by folder name
```

## CI

Append `--run` to any command.

```bash
pnpm test:unit --run
```

Additional flags (pass as needed, don't bake into package.json):

```bash
--reporter=junit --outputFile=test-results.xml   # GitHub Actions PR test results
--coverage                                        # coverage reports
--pool=forks                                      # more isolated than default threads
```

Integration tests need API keys — run on schedule or manually, not on every PR:

```yaml
- run: pnpm test:integration --run
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Global Setup

- **`vitest.shared.ts`** — shared config base. All app-level configs extend via `withShared()`. Contains path aliases, excludes, coverage config, setup file reference.
- **`vitest.setup.ts`** — runs before every test file. Global mocks, custom matchers, env setup.
- **`.env.test`** — copy `.env.test.example`, fill in values. Used by integration tests. Gitignored.
- **TypeScript** — vitest globals typed via `"types": ["vitest/globals"]` in root tsconfig.
- **Coverage** — `@vitest/coverage-v8`, opt-in: `pnpm test:unit --run --coverage`. Covers `app/` and `lib/`.

## Workspace Architecture

`vitest.workspace.ts` orchestrates all projects. Worker configs are auto-discovered via glob.

### Projects

| Project name | Config file | Scope |
|---|---|---|
| `app-unit` | `vitest.unit.config.ts` | `*.test.ts` (excluding `*.integration.test.ts`, `*.e2e.test.ts`) in app/, lib/, etc. |
| `app-integration` | `vitest.integration.config.ts` | `*.integration.test.ts` in app/, lib/ |
| `app-e2e` | `vitest.e2e.config.ts` | `*.e2e.test.ts` in app/, lib/ |
| `common` | `common/vitest.config.ts` | `*.test.ts` in common/ |
| `common-integration` | `common/vitest.integration.config.ts` | `*.integration.test.ts` in common/ |
| `workers_common` | `workers/_common/vitest.config.ts` | `*.test.ts` in workers/_common/ |
| `workers-*` | `workers/*/vitest.config.ts` | `*.test.ts` in each worker |

Each worker config has its own project name (e.g. `workers-chat`). `--project workers-*` matches all of them but not `workers_common`.

### Path aliases

| Alias | Resolves to |
|-------|-------------|
| `@/*` | Project root |
| `@common/*` | `common/` (git submodule) |
| `@worker/*` | `workers/_common/` |

### Submodule standalone usage

`common/` has its own vitest configs and scripts. When developing independently (`cd common`):

```bash
pnpm test                    # all tests, watch mode
pnpm test:unit               # unit only
pnpm test:integration        # integration only
```

Same config files the parent workspace references — no duplication.

## Integration Test Guidelines (Inference Layer)

For testing AI inference wrappers against real providers:

- **Use cheap models** — `gpt-4o-mini`, `claude-haiku`, etc.
- **Constrain output** — short prompts, `max_tokens: 50`
- **Test the contract, not the content** — assert on structure (has `content`, has `usage`, stream yields chunks), not exact wording
- **Skip if no keys**:

```ts
const hasOpenAI = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasOpenAI)("OpenAI integration", () => {
  // ...
});
```

### What to cover

| Area | Validates |
|------|-----------|
| Basic completion | Auth + request format works |
| Streaming | SSE/stream parsing isn't broken |
| Error handling | Invalid model, rate limit, bad key → proper error types |
| Provider normalization | All providers return the same shape |
| Tool/function calling | Schema gets through correctly |
| Reasoning/thinking | Extended thinking blocks parse correctly |
| Search/citations | Web search results normalize properly |

## Next.js Specific

### API Routes

Test with `fetch` against the running dev server. Use `*.e2e.test.ts`.

### Server Actions

No stable HTTP endpoint — call the function directly:

```ts
import { createProject } from "@/app/actions/project";

it("creates a project", async () => {
  const result = await createProject({ name: "Test" });
  expect(result.id).toBeDefined();
});
```

Mock Next.js internals as needed:

```ts
vi.mock("next/navigation", () => ({
  redirect: (path: string) => path,
}));
```

### React Components

Not set up yet. When needed, the `app` vitest config will need:
- `@vitejs/plugin-react` + `jsdom` environment
- `@testing-library/react` + `@testing-library/dom`
- `vite-tsconfig-paths`

Async Server Components are **not supported** by vitest yet — use e2e/Playwright for those.

### References

- [Next.js Vitest Guide](https://nextjs.org/docs/app/guides/testing/vitest)
- [Testing Server Actions Discussion](https://github.com/vercel/next.js/discussions/69036)

## Playwright (Browser Tests)

Config: `playwright.config.ts`. Tests: `tests/pw/`, `*.spec.ts` files. Chromium only (add others via `npx playwright install`).

### Commands

```bash
pnpm pw                  # run all browser tests (headless)
pnpm pw:ui               # interactive UI mode
pnpm pw:codegen           # record clicks → generates test code
```

### CI

```yaml
- run: pnpm pw
  env:
    CI: true
    BASE_URL: ${{ env.STAGING_URL }}
```

### Traces & Debugging

- **Traces** captured on first retry — `npx playwright show-trace`
- **Screenshots** on failure — `tests/pw/.results/`
- **HTML report** — `npx playwright show-report`

## Auth Mocking (Clerk)

Reusable Clerk auth mocks for vitest and Playwright. No source code modifications — works via `vi.mock()`.

| File | Purpose |
|------|---------|
| `tests/helpers/factories.ts` | `createMockClerkUser()` factory |
| `tests/helpers/clerk-mock.ts` | Vitest mock for `@clerk/nextjs/server` (Next.js app) |
| `tests/helpers/clerk-worker-mock.ts` | Vitest mock for `workers/_common/vendor/clerk.ts` (workers) |
| `tests/pw/auth.setup.ts` | Playwright login + storageState |

### Vitest — Next.js

```ts
import { mockClerkNextjs, setMockClerkUser, clearMockClerkUser } from "@/tests/helpers/clerk-mock";

mockClerkNextjs(); // hoisted vi.mock — call at top level

beforeEach(() => clearMockClerkUser());

it("authed request", async () => {
  setMockClerkUser({ userId: "user_123" });
  const result = await assertClerkAuth();
  expect(result.userId).toBe("user_123");
});

it("unauthed request", async () => {
  setMockClerkUser(null);
  await expect(assertClerkAuth()).rejects.toThrow("Unauthorized");
});
```

`assertAuth()` and `withAuth()` also do a DB lookup — mock `@/lib/orm/orm` separately for those.

### Vitest — Workers (Hono)

```ts
import { mockClerkWorker, setMockWorkerUser, clearMockWorkerUser } from "@/tests/helpers/clerk-worker-mock";

mockClerkWorker(); // hoisted vi.mock

beforeEach(() => clearMockWorkerUser());

it("returns data for authed user", async () => {
  setMockWorkerUser({ userId: "user_abc" });
  const res = await app.request("/api/data");
  expect(res.status).toBe(200);
});
```

Worker middleware also calls `initInferredContext` — mock that separately if your test hits ORM/context setup.

### Playwright

Uses `storageState` pattern. The `setup` project runs `tests/pw/auth.setup.ts` first (logs in via Clerk UI, saves cookies to `tests/pw/.auth/user.json`). All other projects reuse that state.

Required env vars: `E2E_CLERK_EMAIL`, `E2E_CLERK_PASSWORD`.

If Clerk uses CAPTCHA/bot protection, see fallback instructions in `auth.setup.ts` for manually saving a cookie fixture.

## SSE Stream Testing

`tests/helpers/streams.ts` — utilities for consuming real SSE responses and asserting on their contents. Reuses the app's own `parseSSEChunk`/`parseStreamEventData`.

```ts
import { collectStreamEvents, expectNoEvents, expectStreamDone, eventsOfType } from "@/tests/helpers/streams";

it("redacts tool calls from the stream", async () => {
  const res = await fetch(`${BASE_URL}/api/chat`, { method: "POST", body });
  const events = await collectStreamEvents(res);

  expectStreamDone(events);
  expectNoEvents(events, "tool_start", "tool_result");
});
```

Key exports: `collectStreamEvents`, `consumeStream` (with per-event callback), `eventsOfType`, `collectText`, `collectDocuments`, `expectNoEvents`, `expectStreamDone`, `expectStreamError`.

## Adding a New Worker

1. Create `workers/<name>/vitest.config.ts` — copy from `workers/chat/vitest.config.ts`
2. Auto-discovered by workspace glob (`./workers/*/vitest.config.ts`)
3. Use project name `"workers"` so `test:workers` picks it up
4. No changes needed to workspace config or package.json scripts
