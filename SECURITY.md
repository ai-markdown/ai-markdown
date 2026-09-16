# Security Policy

## Reporting a vulnerability

`ai-markdown` renders untrusted markdown — typically from LLM output, which can contain anything. The library's two-gate URL sanitization, schema-enforced HTML allowlists, and cross-chunk URL re-sanitization filter untrusted HTML and URLs by default. If you believe you've found a bypass, **please report it privately**.

**Do not file a public issue or PR for security vulnerabilities.**

Use GitHub's private advisory flow:

→ [Report a vulnerability](https://github.com/ai-markdown/ai-markdown/security/advisories/new)

This creates a private channel between you and the maintainer. We'll triage as soon as possible.

## What to include

- The package and exact version (`@ai-markdown/react@x.y.z`, `@ai-markdown/vue@x.y.z`, `@ai-markdown/core@x.y.z`, `@ai-markdown/engine@x.y.z`, or `@ai-markdown/react-mantine@x.y.z`).
- A **minimal** markdown input that triggers the vulnerability — the smallest input that demonstrates the issue.
- The framework (React or Vue) and relevant `<AIMarkdown>` / `<MantineAIMarkdown>` props (custom `urlTransform`, `sanitizeSchema`, etc.). If you're using defaults, say so.
- The observed behavior (what was rendered) vs the expected (what should have been filtered).
- Whether the issue requires user interaction (e.g. clicking a link) or fires on render alone.

## Scope

In scope:

- XSS or script injection via crafted markdown that passes default sanitization.
- Sanitization bypass — URLs / tags / attributes / classes that survive both gates but shouldn't.
- Cross-chunk reference escapes — a definition in one `<AIMarkdown>` instance influencing another in unintended ways.
- Prototype pollution, denial of service via crafted input, etc.

Out of scope:

- Issues that require the consumer to explicitly loosen the defaults — a permissive custom `urlTransform`, or a `sanitizeSchema` (via `extendSanitizeSchema`) that re-admits dangerous tags/attributes/protocols (documented escape hatches; if you do that, you own the safety). Note that `urlTransform={null}` is _not_ an escape hatch: `null` means "use the default" and falls back to `defaultUrlTransform`.
- Vulnerabilities in upstream packages (`rehype-sanitize`, `katex`, `mermaid`, and the raw-HTML forks `@ai-markdown/rehype-raw`, `@ai-markdown/hast-util-raw` and `@ai-markdown/hast-util-from-parse5`) that aren't amplified by anything `ai-markdown` does. `react-markdown` is not a dependency: its transform code is vendored into the engine and the React adapter, so a problem in that code is in scope here.
- Social engineering, supply-chain attacks against your own dev environment, etc.

## Supported versions

| Package line                                     | Support                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `@ai-markdown` 3.x release train                 | Current stable line; update to the latest stable release         |
| `@ai-markdown/remark-mark-highlight` 1.x         | Independently versioned; update to the latest stable release     |
| `@ai-markdown/code-language-detector` 1.x        | Independently versioned; update to the latest stable release     |
| Legacy `@ai-react-markdown` 2.x                  | Deprecated; critical fixes considered as needed, no new features |
| Older legacy versions and superseded prereleases | Upgrade to the current stable packages                           |

See the [migration guide](https://ai-markdown.github.io/docs/guides/framework-transition/) for package mappings. Legacy artifacts remain available; deprecation adds migration notices without removing existing versions.

## Public disclosure

After a fix is shipped, we'll publish a GitHub Security Advisory with the CVE (if applicable), affected versions, and credit to the reporter (unless you'd prefer to stay anonymous).
