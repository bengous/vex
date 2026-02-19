# Repository Guidelines

## Project Structure & Module Organization
Core code lives in `src/` and is organized by layer:
- `src/core`: pure capture/analysis primitives and shared types.
- `src/pipeline`: composable operations and runtime orchestration.
- `src/locator`: code-location strategies for UI issues.
- `src/loop`: iterative verify/fix orchestration.
- `src/providers`: VLM provider implementations (`codex-cli`, `claude-cli`, etc.) plus shared provider utilities.
- `src/cli`: `@effect/cli` commands (`scan`, `analyze`, `locate`, `loop`, `verify`, `providers`).
- `src/testing` and `src/fixtures`: test helpers and fixtures.
- `src/e2e`: end-to-end tests.

Use leaf imports inside modules; avoid creating barrel files.

## Build, Test, and Development Commands
- `bun install`: install dependencies.
- `bun run dev -- --help`: run the CLI entrypoint during local development.
- `bun run typecheck`: run TypeScript checks with no emit.
- `bun run lint`: run Biome lint checks on `src/`.
- `bun run lint:fix`: auto-apply Biome fixes where possible.
- `bun run test`: run unit/integration tests, excluding e2e.
- `bun run test:all`: run every test under `src/`.
- `bun run test:e2e`: run e2e tests in `src/e2e/` (requires provider auth/config).

## Coding Style & Naming Conventions
- Language: TypeScript (`.ts`), ESM-style imports with `.js` extensions in import paths.
- Indentation: 2 spaces; keep functions small and strongly typed.
- Linting: Biome (`biome.json`) with `noBarrelFile` enforced and `noNonNullAssertion` warned.
- Naming: files use kebab-case (`overlay-grid.ts`); tests use `*.test.ts`; types/interfaces use PascalCase; functions/variables use camelCase.

## Testing Guidelines
- Framework/runtime: `bun test`.
- Place tests adjacent to code as `*.test.ts`; e2e tests in `src/e2e/*.e2e.test.ts`.
- Add or update tests for behavior changes in pipeline operations, provider wiring, and CLI option resolution.
- Before opening a PR, run: `bun run typecheck && bun run lint && bun run test`.

## Commit & Pull Request Guidelines
- Follow Conventional Commit style seen in history: `type(scope): summary` (example: `refactor(vex): remove internal barrel exports`).
- Common types: `chore`, `refactor`, `docs`.
- Keep commits focused and atomic; include tests/docs with behavioral changes.
- PRs should include: concise description, why the change is needed, test evidence (commands run), and sample CLI output or screenshots when UX/output changes.
