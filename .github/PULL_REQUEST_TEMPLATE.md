<!-- Thanks for opening a PR! A few quick checks before submitting. -->

## Summary

<!-- One or two sentences: what does this PR change, and why? -->

## Type

<!-- Tick whichever apply -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds capability)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Documentation only
- [ ] Internal / chore (build, CI, refactor with no behavior change)

## Test plan

<!--
How can a reviewer verify this works?
- For bug fixes: include the markdown input that previously broke and now renders correctly.
- For new features: include a minimal `<AIMarkdown>` usage example.
- For streaming-related changes: describe the chunk sequence and any timing assumptions.
-->

## Related issues / discussions

<!-- e.g. "Closes #42" or "Discussed in #57" -->

## Checklist

- [ ] I've read [`CONTRIBUTING.md`](../CONTRIBUTING.md)
- [ ] Relevant tests pass locally (see [Development commands](../apps/docs/content/guides/development-commands.md))
- [ ] Typecheck passes for the changed packages and stories (`pnpm typecheck` for the full workspace)
- [ ] Lint passes (`pnpm lint`)
- [ ] Format check passes (`pnpm format:check`)
- [ ] Docs updated if the public API or behavior changed (`README.md` / `apps/docs/content/guides/` / JSDoc)
- [ ] For breaking changes: migration path documented in the PR description
