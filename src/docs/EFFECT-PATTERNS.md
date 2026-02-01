# Effect.js Patterns in vex

A practical guide to Effect patterns used in this codebase. Written for developers coming from traditional TypeScript/Promise-based code.

## Table of Contents

1. [Why Effect?](#why-effect)
2. [Effect.gen — Generator-Based Composition](#1-effectgen--generator-based-composition)
3. [Effect.pipe — Pipeline Composition](#2-effectpipe--pipeline-composition)
4. [Tagged Errors — Pattern-Matchable Failures](#3-tagged-errors--pattern-matchable-failures)
5. [Effect.catchTag — Discriminated Error Handling](#4-effectcatchtag--discriminated-error-handling)
6. [Layers — Dependency Injection](#5-layers--dependency-injection)
7. [Context.Tag — Service Identity](#6-contexttag--service-identity)
8. [Schema Validation — Types from Runtime](#7-schema-validation--types-from-runtime)
9. [Effect.tryPromise — Promise Bridge](#8-effecttrypromise--promise-bridge)
10. [The DAG Runtime — Topological Execution](#9-the-dag-runtime--topological-execution)
11. [Quick Reference](#quick-reference)

---

## Why Effect?

Effect solves three problems that plague large TypeScript codebases:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PROBLEM                           EFFECT SOLUTION                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Errors are invisible           Errors are TYPED in the signature    │
│     function load(): Config        function load(): Effect<Config, Err> │
│     // Can this throw? Who knows!  // Error type is explicit            │
│                                                                         │
│  2. Dependencies are implicit      Dependencies are DECLARED            │
│     import { db } from './db';     yield* Database; // asks for it      │
│     // Global singleton            // Provided at runtime               │
│                                                                         │
│  3. Async is contagious            Everything is Effect                 │
│     async/await everywhere         Sync and async unified               │
│     Promise<Promise<T>> confusion  Effect<T, E, R> always               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**The Effect type signature:**

```
Effect<Success, Error, Requirements>
       ▲        ▲      ▲
       │        │      └── Services this effect needs (dependency injection)
       │        └── Error types this effect can fail with
       └── Success type when effect completes
```

---

## 1. Effect.gen — Generator-Based Composition

This is the pattern you'll use most. It makes async code look synchronous.

### The Problem with Promises

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Promise Chain (callback hell)     vs    Effect.gen (linear)            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  loadConfig()                              Effect.gen(function* () {    │
│    .then(config =>                           const config = yield* loadConfig();
│      getPreset(config, name)                 const preset = yield* getPreset(config, name);
│        .then(preset =>                       const resolved = yield* resolve(preset);
│          resolve(preset)                     return resolved;           │
│            .then(resolved =>               });                          │
│              resolved                                                   │
│            )                                                            │
│        )                                                                │
│    )                                                                    │
│                                                                         │
│  Nested, hard to follow             Reads top-to-bottom like sync code  │
└─────────────────────────────────────────────────────────────────────────┘
```

### How yield\* Works

The `yield*` operator unwraps an Effect to get its success value. If the Effect fails, execution stops and the error propagates.

```
   Effect.gen(function* () {
       │
       │     ┌────────────────────────────────┐
       │     │  const config = yield* load(); │
       │     └───────────────┬────────────────┘
       │                     │
       │         ┌───────────▼───────────┐
       │         │   load() returns      │
       │         │   Effect<Config, Err> │
       │         └───────────┬───────────┘
       │                     │
       │         ┌───────────▼───────────┐
       │         │   yield* UNWRAPS it   │
       │         │   config = Config     │
       │         │   (or fails on Err)   │
       │         └───────────┬───────────┘
       │                     │
       ▼                     ▼
   Continue with plain Config value
```

### Real Example

**File:** `vex/config/loader.ts:56-92`

```typescript
export function loadConfig(projectRoot?: string): Effect.Effect<VexConfig, ConfigError> {
  return Effect.gen(function* () {
    // yield* unwraps Effect<string, ConfigError> → string
    const root = projectRoot ?? (yield* findProjectRoot(process.cwd()));

    const configPath = path.join(root, 'vex.config.ts');

    // yield* unwraps Effect<Module, ConfigError> → Module
    const module = yield* Effect.tryPromise({
      try: () => import(configPath),
      catch: (error) => new ConfigError({ kind: 'invalid_schema', ... }),
    });

    const raw = module.default;

    // yield* unwraps Effect<VexConfig, ConfigError> → VexConfig
    const decoded = yield* S.decodeUnknown(VexConfig)(raw).pipe(
      Effect.mapError((parseError) => new ConfigError({ kind: 'invalid_schema', ... })),
    );

    return decoded;  // Final return is the success value
  });
}
```

### Mental Model

Think of `yield*` as `await` but for Effects:

```typescript
// Promise world
async function load() {
  const config = await loadConfig(); // unwrap Promise
  const preset = await getPreset(config); // unwrap Promise
  return preset;
}

// Effect world
function load() {
  return Effect.gen(function* () {
    const config = yield* loadConfig(); // unwrap Effect
    const preset = yield* getPreset(config); // unwrap Effect
    return preset;
  });
}
```

The difference: Effect tracks errors in types, Promise doesn't.

---

## 2. Effect.pipe — Pipeline Composition

Use `.pipe()` to chain transformations on an Effect.

### The Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Effect Pipeline                                  │
└─────────────────────────────────────────────────────────────────────────┘

  subprocess.exec(command, args, timeout)
          │
          │  Returns: Effect<SubprocessResult, SubprocessError>
          │
          ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │  .pipe(                                                               │
  │      Effect.tap(...)      ──▶  Side effect (logging), value unchanged │
  │      Effect.map(...)      ──▶  Transform success value                │
  │      Effect.mapError(...) ──▶  Transform error value                  │
  │  )                                                                    │
  └───────────────────────────────────────────────────────────────────────┘
          │
          │  Returns: Effect<AnalysisResult, AnalysisFailed>
          ▼
```

### Success vs Error Flow

```
                    subprocess.exec()
                          │
            ┌─────────────┴─────────────┐
            │                           │
         SUCCESS                      ERROR
            │                           │
            ▼                           │
      Effect.tap()                      │
      (logs "completed")                │
            │                           │
            ▼                           │
      Effect.map()                      │
      (transform result)                │
            │                           │
            │                           ▼
            │                    Effect.mapError()
            │                    (transform error)
            │                           │
            ▼                           ▼
    ┌───────────────┐           ┌───────────────┐
    │ AnalysisResult│           │AnalysisFailed │
    └───────────────┘           └───────────────┘
```

### Operators Explained

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   Effect.tap()     │ Run side effect, pass value through unchanged      │
│                    │ Use for: logging, metrics, notifications           │
│                    │                                                    │
│   Effect.map()     │ Transform success value                            │
│                    │ Use for: reshaping data, extracting fields         │
│                    │                                                    │
│   Effect.mapError()│ Transform error value (only runs on failure)       │
│                    │ Use for: wrapping errors, adding context           │
│                    │                                                    │
│   Effect.flatMap() │ Chain another Effect (like .then())                │
│                    │ Use for: sequential async operations               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### tap vs map

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Effect.tap()                      Effect.map()                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  • For SIDE EFFECTS                • For TRANSFORMATIONS                │
│  • Return value is IGNORED         • Return value becomes new value     │
│  • Value passes through unchanged  • Value is replaced                  │
│                                                                         │
│  Effect.tap((x) => {               Effect.map((x) => {                  │
│    console.log(x);                   return x * 2;                      │
│    return 999; // ignored          });                                  │
│  });                                                                    │
│                                                                         │
│  Input: 5  ──▶  Output: 5          Input: 5  ──▶  Output: 10            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Real Example

**File:** `vex/providers/cli-factory.ts:81-90`

```typescript
return subprocess.exec(command, args, timeout).pipe(
  // Log completion (side effect, value unchanged)
  Effect.tap(() => console.log(`[cli-factory] subprocess.exec completed`)),

  // Transform SubprocessResult → AnalysisResult
  Effect.map((result) => ({
    response: result.stdout.trim(),
    durationMs: result.durationMs,
    model,
    provider: name,
  })),

  // Transform SubprocessError → AnalysisFailed (only on error)
  Effect.mapError((err) => mapSubprocessError(name, err)),
);
```

### Promise Equivalent

```typescript
// Effect version
subprocess.exec(command, args, timeout).pipe(
  Effect.tap(() => console.log('completed')),
  Effect.map((result) => ({ response: result.stdout.trim() })),
  Effect.mapError((err) => new AnalysisFailed(err)),
);

// Promise equivalent
execPromise(command, args, timeout)
  .then((result) => {
    console.log('completed'); // tap = side effect
    return result; // pass through
  })
  .then((result) => ({
    // map = transform
    response: result.stdout.trim(),
  }))
  .catch((err) => {
    // mapError = transform error
    throw new AnalysisFailed(err);
  });
```

---

## 3. Tagged Errors — Pattern-Matchable Failures

### The Problem with Traditional Errors

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Traditional Errors                  vs    Tagged Errors                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  throw new Error("not found")              Effect.fail(new ConfigError({│
│  throw new Error("invalid")                  _tag: 'ConfigError',       │
│  throw new Error("timeout")                  kind: 'not_found',         │
│                                              path: '/path/to/file',     │
│  // All look the same!                     }))                          │
│  // Can only match on message string                                    │
│  // No type safety                         // Type-safe!                │
│                                            // Pattern matchable!        │
│                                            // Carries structured data!  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Creating Tagged Errors

**File:** `vex/config/loader.ts:20-25`

```typescript
export class ConfigError extends Data.TaggedError('ConfigError')<{
  readonly kind: 'not_found' | 'invalid_schema' | 'preset_not_found' | 'missing_required';
  readonly message: string;
  readonly path?: string;
  readonly availablePresets?: readonly string[];
}> {}
```

This creates:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  new ConfigError({                                                      │
│    kind: 'not_found',                                                   │
│    message: 'Config file not found',                                    │
│    path: '/path/to/vex.config.ts',                                      │
│  })                                                                     │
│                                                                         │
│  Results in:                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  {                                                              │    │
│  │    _tag: 'ConfigError',     ◄── Discriminator for matching      │    │
│  │    kind: 'not_found',       ◄── Your custom fields              │    │
│  │    message: '...',                                              │    │
│  │    path: '/path/...',                                           │    │
│  │  }                                                              │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Error Hierarchy in vex

**File:** `vex/providers/service.ts:14-33`

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Three distinct provider error types:                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────┐ │
│   │ ProviderUnavailable │  │   ModelNotFound     │  │  AnalysisFailed │ │
│   ├─────────────────────┤  ├─────────────────────┤  ├─────────────────┤ │
│   │ _tag: 'Provider...' │  │ _tag: 'ModelNot...' │  │ _tag: 'Analysis'│ │
│   │ provider: string    │  │ provider: string    │  │ provider: string│ │
│   │ reason: string      │  │ model: string       │  │ kind: string    │ │
│   │ suggestion?: string │  │ available: string[] │  │ message: string │ │
│   └─────────────────────┘  └─────────────────────┘  │ cause?: unknown │ │
│                                                     └─────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why This Matters

```typescript
// Traditional: fragile string matching
try {
  await analyze(image);
} catch (e) {
  if (e.message.includes('not found')) {
    // Fragile!
    // handle not found
  } else if (e.message.includes('timeout')) {
    // What if message changes?
    // handle timeout
  }
}

// Effect: type-safe pattern matching
analyze(image).pipe(
  Effect.catchTag('ProviderUnavailable', (e) => {
    // e.provider, e.reason, e.suggestion are all typed!
    return fallbackProvider();
  }),
  Effect.catchTag('AnalysisFailed', (e) => {
    if (e.kind === 'timeout') {
      return retry();
    }
    return Effect.fail(e);
  }),
);
```

---

## 4. Effect.catchTag — Discriminated Error Handling

Catch specific error types by their `_tag` field.

### Flow Diagram

```
                    loadConfig()
                         │
         ┌───────────────┴───────────────┐
         │                               │
      SUCCESS                     FAIL (ConfigError)
         │                               │
         │                    ┌──────────┴──────────┐
         │                    │                     │
         │              kind='not_found'      kind='invalid_schema'
         │                    │                     │
         │                    ▼                     │
         │           ┌─────────────────┐            │
         │           │ Return undefined│            │
         │           │ (convert to     │            │
         │           │  success)       │            │
         │           └─────────────────┘            │
         │                                          │
         ▼                                          ▼
   ┌───────────┐                           ┌───────────────┐
   │  VexConfig │                           │ ConfigError   │
   │  (success) │                           │ (propagates)  │
   └───────────┘                           └───────────────┘
```

### Real Example

**File:** `vex/config/loader.ts:188-194`

```typescript
export function loadConfigOptional(projectRoot?: string) {
  return loadConfig(projectRoot).pipe(
    Effect.catchTag(
      'ConfigError',
      (error) =>
        // Only catches ConfigError, not other error types

        error.kind === 'not_found'
          ? Effect.succeed(undefined) // Convert "not found" to success
          : Effect.fail(error), // Re-throw other kinds
    ),
  );
}
```

### Multiple Error Types

```typescript
// Handle different errors differently
analyzeImage(path).pipe(
  Effect.catchTag('ProviderUnavailable', (e) => {
    console.log(`Provider ${e.provider} unavailable: ${e.reason}`);
    if (e.suggestion) {
      console.log(`Try: ${e.suggestion}`);
    }
    return tryFallbackProvider();
  }),

  Effect.catchTag('ModelNotFound', (e) => {
    console.log(`Model ${e.model} not found. Available: ${e.available.join(', ')}`);
    return useDefaultModel();
  }),

  Effect.catchTag('AnalysisFailed', (e) => {
    if (e.kind === 'timeout') {
      return retryWithLongerTimeout();
    }
    // Re-throw non-timeout failures
    return Effect.fail(e);
  }),
);
```

---

## 5. Layers — Dependency Injection

Layers are Effect's killer feature. No more global singletons or import-time side effects.

### The Problem with Traditional DI

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   Traditional (globals)             Effect Layers                       │
│   ─────────────────────             ─────────────                       │
│                                                                         │
│   // Global singleton               // Service Tag (identity)           │
│   const db = new Database();        class Database extends              │
│                                       Context.Tag('Database')<...>{}    │
│   // Import everywhere                                                  │
│   import { db } from './db';        // Layer (implementation)           │
│                                     const DbLive = Layer.succeed(       │
│   // Problems:                        Database,                         │
│   // - Hard to test                   { query: (...) => ... }           │
│   // - Hard to swap                 );                                  │
│   // - Hidden dependencies                                              │
│   // - Import order matters         // Usage                            │
│                                     Effect.gen(function* () {           │
│                                       const db = yield* Database;       │
│                                       return db.query(...);             │
│                                     }).pipe(                            │
│                                       Effect.provide(DbLive)            │
│                                     );                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### How Layers Flow

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │                         YOUR CODE                                    │
   │                                                                      │
   │   const program = Effect.gen(function* () {                          │
   │     const subprocess = yield* Subprocess;  ◄── "I need Subprocess"   │
   │     return subprocess.exec("ls", ["-la"]);                           │
   │   });                                                                │
   │                                                                      │
   │   // Type: Effect<Result, Error, Subprocess>                         │
   │   //                             ▲                                   │
   │   //                    "Requires Subprocess service"                │
   └──────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ Effect.provide(SubprocessLive)
                                      ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │                         LAYER IMPLEMENTATION                         │
   │                                                                      │
   │   const SubprocessLive = Layer.succeed(Subprocess, {                 │
   │     exec: (cmd, args, timeout) => Effect.promise(async () => {       │
   │       const proc = Bun.spawn([cmd, ...args]);                        │
   │       // ... real implementation                                     │
   │       return { stdout, stderr, exitCode };                           │
   │     }),                                                              │
   │   });                                                                │
   │                                                                      │
   └──────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │   // Type: Effect<Result, Error, never>                              │
   │   //                             ▲                                   │
   │   //                    "All dependencies satisfied!"                │
   └──────────────────────────────────────────────────────────────────────┘
```

### Creating Layers

**Simple Layer (no dependencies):**

**File:** `vex/providers/subprocess.ts:58-158`

```typescript
export const SubprocessLive = Layer.succeed(Subprocess, {
  exec: (command, args, timeoutMs) =>
    Effect.promise(async () => {
      const proc = Bun.spawn([command, ...args]);
      // ... implementation
      return { stdout, stderr, exitCode, durationMs };
    }),

  commandExists: (command) =>
    Effect.promise(async () => {
      const result = await Bun.spawn(['which', command]);
      return result.exitCode === 0;
    }),
});
```

**Layer with dependencies:**

**File:** `vex/providers/cli-factory.ts:60-105`

```typescript
export function createCliProviderLayer(config: CliProviderConfig): Layer.Layer<VisionProvider> {
  const providerLayer = Layer.effect(
    VisionProvider,
    Effect.gen(function* () {
      // This layer DEPENDS on Subprocess
      const subprocess = yield* Subprocess;

      return {
        name: config.name,
        analyze: (images, prompt, options) => {
          const args = config.buildArgs(model, prompt, images, options);
          // Use the injected subprocess service
          return subprocess.exec(config.command, args, timeout).pipe(
            Effect.map((result) => ({
              response: result.stdout.trim(),
              // ...
            })),
          );
        },
      };
    }),
  );

  // Wire Subprocess into this layer
  return Layer.provide(providerLayer, SubprocessLive);
}
```

### Layer Composition Diagram

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │  createCliProviderLayer(config)                                     │
   │                                                                     │
   │  ┌───────────────────────────────────────────────────────────────┐  │
   │  │  Layer.effect(VisionProvider, Effect.gen(function* () {       │  │
   │  │                                                               │  │
   │  │    const subprocess = yield* Subprocess;  ◄── Dependency      │  │
   │  │                                                               │  │
   │  │    return {                                                   │  │
   │  │      analyze: (images, prompt) =>                             │  │
   │  │        subprocess.exec(cmd, args),       ◄── Use dependency   │  │
   │  │    };                                                         │  │
   │  │                                                               │  │
   │  │  }))                                                          │  │
   │  └───────────────────────────────────────────────────────────────┘  │
   │                          │                                          │
   │                          │  Layer.provide(..., SubprocessLive)      │
   │                          ▼                                          │
   │  ┌───────────────────────────────────────────────────────────────┐  │
   │  │  Complete VisionProvider layer                                │  │
   │  │  (Subprocess already wired in, ready to use)                  │  │
   │  └───────────────────────────────────────────────────────────────┘  │
   │                                                                     │
   └─────────────────────────────────────────────────────────────────────┘
```

### Testing with Layers

```typescript
// Production: real subprocess
const program = analyze(image).pipe(Effect.provide(CodexCliProviderLayer));

// Test: mock subprocess
const MockSubprocess = Layer.succeed(Subprocess, {
  exec: () =>
    Effect.succeed({
      stdout: '{"issues": []}',
      stderr: '',
      exitCode: 0,
      durationMs: 100,
    }),
  commandExists: () => Effect.succeed(true),
});

const MockProvider = Layer.provide(
  createCliProviderLayer(codexConfig),
  MockSubprocess, // Inject mock instead of real
);

const testProgram = analyze(image).pipe(Effect.provide(MockProvider));
```

---

## 6. Context.Tag — Service Identity

Tags are the "keys" in Effect's dependency injection system.

### Defining a Service

**File:** `vex/providers/service.ts:84-85`

```typescript
// 1. Define the service interface
export interface VisionProviderService {
  readonly name: string;
  readonly displayName: string;
  analyze(images: string[], prompt: string, options?: VisionQueryOptions): Effect.Effect<AnalysisResult, ProviderError>;
  isAvailable(): Effect.Effect<boolean>;
  listModels(): Effect.Effect<readonly string[]>;
}

// 2. Create the Tag (service identity)
export class VisionProvider extends Context.Tag('VisionProvider')<
  VisionProvider, // The tag class itself
  VisionProviderService // The service interface
>() {}
```

### How Tags Work

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   Context.Tag('VisionProvider')                                         │
│        │                                                                │
│        │  Creates a unique identifier                                   │
│        ▼                                                                │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  VisionProvider                                                 │   │
│   │  ├── Unique symbol: Symbol('VisionProvider')                    │   │
│   │  └── Type info: VisionProviderService                           │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│        │                                                                │
│        │  Used as key in Effect context                                 │
│        ▼                                                                │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  Context Map (at runtime)                                       │   │
│   │  {                                                              │   │
│   │    [VisionProvider]: { analyze: ..., isAvailable: ... },        │   │
│   │    [Subprocess]: { exec: ..., commandExists: ... },             │   │
│   │  }                                                              │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Using Tags

```typescript
// Request a service (in Effect.gen)
const provider = yield * VisionProvider;
//                      ▲
//        TypeScript knows this is VisionProviderService

// The type system ensures you provide it
const program: Effect<Result, Error, VisionProvider> = Effect.gen(function* () {
  const provider = yield* VisionProvider;
  //                                      ▲
  //              VisionProvider appears in Requirements (3rd type param)
  return yield* provider.analyze(images, prompt);
});

// Must provide before running
program.pipe(Effect.provide(SomeProviderLayer));
```

---

## 7. Schema Validation — Types from Runtime

Effect Schema lets you define a schema once and derive both runtime validation and TypeScript types.

### The Problem

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   Traditional                           Effect Schema                   │
│   ───────────                           ─────────────                   │
│                                                                         │
│   // Write type manually                // Define schema once           │
│   interface Provider {                  const ProviderSpec = S.Struct({ │
│     name: 'ollama' | 'codex-cli';         name: S.Literal('ollama'),    │
│     model?: string;                       model: S.optional(S.String),  │
│   }                                     });                             │
│                                                                         │
│   // Write validator manually           // Type derived automatically!  │
│   function validate(x: unknown) {       type Provider =                 │
│     if (typeof x !== 'object') ...        S.Schema.Type<typeof ProviderSpec>;
│     if (!('name' in x)) ...                                             │
│     // ... tedious, error-prone                                         │
│   }                                                                     │
│                                                                         │
│   // Types and validators drift!        // Always in sync!              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Schema Building Blocks

**File:** `vex/config/schema.ts`

```typescript
import * as S from 'effect/Schema';

// Primitives with constraints
export const PositiveInt = S.Number.pipe(S.int(), S.positive());

// Literal unions (like TypeScript literal types)
export const ReasoningLevel = S.Literal('low', 'medium', 'high', 'xhigh');

export const DeviceId = S.Literal(
  'desktop-1920',
  'iphone-15-pro',
  'ipad-pro-11',
  // ...
);

// Structs (objects)
export const OllamaProvider = S.Struct({
  name: S.Literal('ollama'),
  model: S.optional(S.String),
});

export const CodexProvider = S.Struct({
  name: S.Literal('codex-cli'),
  model: S.optional(S.String),
  reasoning: S.optional(ReasoningLevel),
});

// Discriminated unions
export const ProviderSpec = S.Union(OllamaProvider, CodexProvider, ClaudeProvider, GeminiProvider);

// Extract TypeScript type
export type ProviderSpec = S.Schema.Type<typeof ProviderSpec>;
```

### How Discriminated Unions Work

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │  S.Union(OllamaProvider, CodexProvider, ClaudeProvider, ...)        │
   └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │  S.decodeUnknown(ProviderSpec)(input)
                                    ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │                         RUNTIME VALIDATION                          │
   │                                                                     │
   │   input = { name: 'codex-cli', model: 'gpt-5' }                     │
   │                  │                                                  │
   │                  ▼                                                  │
   │   ┌─────────────────────────────────────────────────────────────┐   │
   │   │  Check input.name against each variant:                     │   │
   │   │                                                             │   │
   │   │  name === 'ollama'?     ──▶ NO                              │   │
   │   │  name === 'codex-cli'?  ──▶ YES ──▶ Validate CodexProvider  │   │
   │   │  name === 'claude-cli'? ──▶ (skipped)                       │   │
   │   │  name === 'gemini-cli'? ──▶ (skipped)                       │   │
   │   │                                                             │   │
   │   └─────────────────────────────────────────────────────────────┘   │
   │                  │                                                  │
   │                  ▼                                                  │
   │   Effect<CodexProvider, ParseError>                                 │
   │                                                                     │
   └─────────────────────────────────────────────────────────────────────┘
```

### Using Schema Validation

**File:** `vex/config/loader.ts:79-87`

```typescript
const decoded =
  yield *
  S.decodeUnknown(VexConfig)(raw).pipe(
    Effect.mapError((parseError) => {
      // Format error for humans
      const formatted = ParseResult.TreeFormatter.formatErrorSync(parseError);
      return new ConfigError({
        kind: 'invalid_schema',
        message: `Invalid config:\n${formatted}`,
        path: configPath,
      });
    }),
  );
```

### CLI Options with Schema

**File:** `vex/cli/options.ts`

```typescript
import { Options } from '@effect/cli';
import { DeviceId, ReasoningLevel } from '../config/schema.js';

// Option with schema validation
export const deviceOption = Options.text('device').pipe(
  Options.withAlias('d'),
  Options.withDescription('Device preset'),
  Options.withSchema(DeviceId), // ◄── Validates against schema!
  Options.optional,
);

// Invalid device name = parse error before your code runs
```

---

## 8. Effect.tryPromise — Promise Bridge

Convert Promise-based APIs into Effects with proper error handling.

### Basic Usage

```typescript
// Without error handling (not recommended)
Effect.promise(() => fetch(url));

// With error handling (recommended)
Effect.tryPromise({
  try: () => fetch(url),
  catch: (error) => new FetchError({ url, cause: error }),
});
```

### Real Example

**File:** `vex/config/loader.ts:57-77`

```typescript
// Dynamic import returns Promise, we need Effect
const module =
  yield *
  Effect.tryPromise({
    try: () => import(configPath),
    catch: (error) =>
      new ConfigError({
        kind: 'invalid_schema',
        message: `Failed to load ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
        path: configPath,
      }),
  });
```

### Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   Effect.tryPromise({                                                   │
│     try: () => import(path),    ◄── Promise-returning function          │
│     catch: (e) => new Err(e),   ◄── Error transformer                   │
│   })                                                                    │
│                                                                         │
│         │                                                               │
│         ▼                                                               │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  Promise resolves?                                              │   │
│   │  ├── YES ──▶ Effect.succeed(result)                             │   │
│   │  └── NO  ──▶ catch(error) ──▶ Effect.fail(new Err(error))       │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 9. The DAG Runtime — Topological Execution

The most sophisticated pattern in vex. The pipeline executes operations based on data dependencies, not code order.

### Pipeline Definition

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   What you define (declarative):                                        │
│                                                                         │
│   capture ────┬────▶ overlay-grid ────┐                                 │
│               │                       │                                 │
│               ├────▶ overlay-fold ────┼────▶ analyze ────▶ annotate     │
│               │                       │                                 │
│               └────▶ overlay-responsive┘                                │
│                                                                         │
│   Meaning:                                                              │
│   - capture must run first (no inputs)                                  │
│   - overlays can run in parallel (all need capture output)              │
│   - analyze needs all overlay outputs                                   │
│   - annotate needs analyze output                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Execution Timeline

```
   Time ──────────────────────────────────────────────────────────────▶

   Iteration 1:
   ┌─────────────────────────────────────────────────────────────────────┐
   │  getReadyNodes() → [capture]    (no inputs needed)                  │
   │  Execute: capture                                                   │
   │  Output: screenshot.png                                             │
   └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   Iteration 2:
   ┌─────────────────────────────────────────────────────────────────────┐
   │  getReadyNodes() → [overlay-grid, overlay-fold, overlay-responsive] │
   │                    (all need capture, which is now available)       │
   │                                                                     │
   │  Execute: overlay-grid     ──▶ grid.png                             │
   │  Execute: overlay-fold     ──▶ fold.png       (could parallelize!)  │
   │  Execute: overlay-responsive ──▶ responsive.png                     │
   └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   Iteration 3:
   ┌─────────────────────────────────────────────────────────────────────┐
   │  getReadyNodes() → [analyze]                                        │
   │                    (needs all overlays, now available)              │
   │                                                                     │
   │  Execute: analyze          ──▶ issues.json                          │
   └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
   Iteration 4:
   ┌─────────────────────────────────────────────────────────────────────┐
   │  getReadyNodes() → [annotate]                                       │
   │                    (needs analyze, now available)                   │
   │                                                                     │
   │  Execute: annotate         ──▶ annotated.png                        │
   └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                              ✅ COMPLETE
```

### The Algorithm

**File:** `vex/pipeline/runtime.ts:270-283`

```typescript
while (!isComplete(state) && !hasFailed(state)) {
  // Find nodes whose inputs are ALL satisfied
  const readyNodes = getReadyNodes(state);

  // Deadlock detection
  if (readyNodes.length === 0 && !isComplete(state)) {
    return yield * Effect.fail(makeError('Pipeline deadlock: no ready nodes'));
  }

  // Execute ready nodes (sequential for now, could parallelize)
  for (const nodeId of readyNodes) {
    const result =
      yield *
      executeNode(state, nodeId, ctx).pipe(Effect.mapError((e) => makeError(`Node ${nodeId} failed: ${e.message}`, e)));
    state = result.state; // Immutable state update
  }
}
```

### Why This Design?

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   Benefits of DAG execution:                                            │
│                                                                         │
│   1. DECLARATIVE                                                        │
│      Define what depends on what, not execution order                   │
│                                                                         │
│   2. PARALLELIZABLE                                                     │
│      Independent nodes can run concurrently                             │
│      (overlay-grid, overlay-fold, overlay-responsive)                   │
│                                                                         │
│   3. RESILIENT                                                          │
│      Failure in one branch doesn't affect independent branches          │
│      Deadlock detection prevents infinite loops                         │
│                                                                         │
│   4. EXTENSIBLE                                                         │
│      Add new operations by declaring dependencies                       │
│      No need to modify execution logic                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference

```
┌─────────────────────────────────────────────────────────────────────────┐
│  EFFECT PATTERN CHEATSHEET                                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  COMPOSITION                                                            │
│  ───────────                                                            │
│  Effect.gen        │ Generator-based composition (use yield*)           │
│  .pipe()           │ Chain operators on an Effect                       │
│  yield*            │ Unwrap Effect to get value (or propagate error)    │
│                                                                         │
│  TRANSFORMATIONS                                                        │
│  ───────────────                                                        │
│  Effect.map        │ Transform success value: A → B                     │
│  Effect.flatMap    │ Chain to another Effect: A → Effect<B>             │
│  Effect.mapError   │ Transform error value: E1 → E2                     │
│  Effect.tap        │ Side effect, value unchanged                       │
│  Effect.tapError   │ Side effect on error, error unchanged              │
│                                                                         │
│  ERROR HANDLING                                                         │
│  ──────────────                                                         │
│  Effect.fail       │ Create failed Effect                               │
│  Effect.catchTag   │ Catch specific error by _tag                       │
│  Effect.catchAll   │ Catch all errors                                   │
│  Data.TaggedError  │ Create pattern-matchable error class               │
│                                                                         │
│  DEPENDENCY INJECTION                                                   │
│  ────────────────────                                                   │
│  Context.Tag       │ Define service identity (the "key")                │
│  Layer.succeed     │ Create layer with no dependencies                  │
│  Layer.effect      │ Create layer that depends on other services        │
│  Layer.provide     │ Wire dependencies into a layer                     │
│  Effect.provide    │ Supply layer to an Effect at runtime               │
│                                                                         │
│  SCHEMA                                                                 │
│  ──────                                                                 │
│  S.Struct          │ Define object schema                               │
│  S.Literal         │ Define literal union ('a' | 'b')                   │
│  S.Union           │ Define discriminated union                         │
│  S.optional        │ Make field optional                                │
│  S.decodeUnknown   │ Validate unknown → typed Effect                    │
│  S.Schema.Type<>   │ Extract TypeScript type from schema                │
│                                                                         │
│  INTEROP                                                                │
│  ───────                                                                │
│  Effect.tryPromise │ Convert Promise → Effect with error handling       │
│  Effect.promise    │ Convert Promise → Effect (errors become defects)   │
│  Effect.sync       │ Wrap synchronous code                              │
│  Effect.suspend    │ Defer Effect creation until runtime                │
│                                                                         │
│  RUNNING                                                                │
│  ───────                                                                │
│  Effect.runPromise │ Run Effect, get Promise<A> (throws on error)       │
│  Effect.runSync    │ Run synchronous Effect                             │
│  BunRuntime.runMain│ Run as CLI entry point (handles errors)            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Files Referenced

| File                           | Patterns                                      |
| ------------------------------ | --------------------------------------------- |
| `vex/config/schema.ts`         | Schema, Literal, Union, Struct                |
| `vex/config/loader.ts`         | Effect.gen, tryPromise, TaggedError, catchTag |
| `vex/cli/options.ts`           | Schema validation in CLI                      |
| `vex/cli/resolve.ts`           | Option handling, Effect.gen                   |
| `vex/providers/service.ts`     | Context.Tag, TaggedError                      |
| `vex/providers/subprocess.ts`  | Layer.succeed                                 |
| `vex/providers/cli-factory.ts` | Layer.effect, Layer.provide, pipe             |
| `vex/pipeline/runtime.ts`      | DAG execution, Effect.gen                     |

---

## Further Reading

- [Effect Documentation](https://effect.website/docs/introduction)
- [Effect Schema Guide](https://effect.website/docs/schema/introduction)
- [@effect/cli Documentation](https://github.com/Effect-TS/effect/tree/main/packages/cli)
