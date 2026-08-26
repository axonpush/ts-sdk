# @axonpush/sdk

**This repository has moved to [axonpush/sdks](https://github.com/axonpush/sdks).**

The TypeScript SDK now lives at
[`packages/typescript`](https://github.com/axonpush/sdks/tree/master/packages/typescript),
alongside the Python and .NET SDKs. All three generate from one OpenAPI
contract produced by the backend, and CI compares their resource surfaces
against each other so they cannot drift apart.

## Nothing changes for you

```
npm install @axonpush/sdk
```

Same package, same registry.

## Where things went

| | |
|---|---|
| Source | [`axonpush/sdks` → `packages/typescript`](https://github.com/axonpush/sdks/tree/master/packages/typescript) |
| Issues and pull requests | [axonpush/sdks/issues](https://github.com/axonpush/sdks/issues) |
| Releases | tagged `sdk-ts-v*` in the new repository |

## About this repository

It is archived and read-only.

History came across with `git filter-repo`, so
`git log packages/typescript/src/client.ts` in the new repository still reaches
the original first commit. The `v*` tags stay here as the provenance for the
npm releases published from them; the new repository namespaces its tags
`sdk-ts-v*`, because `v0.0.6` meant three different things across the SDKs that
were merged.
