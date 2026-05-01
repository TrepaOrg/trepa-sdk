# Contributing

Internal notes for maintaining `@trepa/sdk`.

## Repo layout

```
trepa-sdk/
├── openapi.json            # Hand-committed snapshot of the API spec.
├── src/
│   ├── api/schema.ts       # Generated from openapi.json. Do not edit by hand.
│   ├── client.ts           # Cookie-jar-aware Trepa client.
│   ├── auth.ts             # startSession / refreshSession / endSession.
│   ├── sign.ts             # signTransaction.
│   └── index.ts            # Public barrel.
├── examples/               # Runnable examples consuming @trepa/sdk via workspace.
└── .github/workflows/
    └── release.yml         # Manual workflow_dispatch: gen -> build -> publish.
```

## Updating the OpenAPI spec

`openapi.json` at the repo root is the single source of truth and is committed manually. Whenever the API spec changes, replace `openapi.json` with the latest copy (e.g. from [`docs.trepa.app/openapi.json`](https://docs.trepa.app/openapi.json) or from your local API repo) and regenerate:

```bash
pnpm gen          # regenerate ./src/api/schema.ts from ./openapi.json
pnpm build        # produce ./dist
pnpm typecheck    # sanity check
```

Commit the updated `openapi.json` and `src/api/schema.ts` together so the published artefact always matches a known spec.

## Releasing

Releases are cut manually from the [Release](https://github.com/TrepaOrg/trepa-sdk/actions/workflows/release.yml) workflow:

1. Trigger the workflow with the new semver `version` (e.g. `0.2.0`).
2. The workflow regenerates `src/api/schema.ts` from the committed `openapi.json`, builds with `tsup`, bumps `package.json` to the requested version (committed back to `master`), publishes `@trepa/sdk` to npm with provenance, and creates a `vX.Y.Z` GitHub release.

The `NPM_TOKEN` repository secret must be set to a granular npm token that can publish to the `@trepa` scope.

Use `dry_run: true` to validate the pipeline without publishing.
