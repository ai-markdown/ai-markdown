# Build a React integration

These examples target the current package train. Match the React peer version when distributing an integration; see [Getting started](getting-started.md) for installation and package boundaries.

Here, the base renderer, its props, providers and hooks belong to `@ai-markdown/react`. The separate `@ai-markdown/core` supplies framework-independent orchestration and has no React context or UI API. UI integrations keep the React adapter as a peer; framework adapters depend on shared core and engine.

Build a React integration by wrapping `@ai-markdown/react` and defining the design-system behavior around it. Mantine is the reference implementation: it supplies typography, code-block presentation, theme defaults, and typed behavior options while the React adapter and its shared dependencies supply parsing, sanitization, references, and streaming.

This guide follows that same construction in nine steps, from a behavior-group interface to the package's public barrel and peer dependencies. The `Your…` components and `your-design-system` imports are template names to implement in your package; they are not installed modules. Examples show the contracts you need to preserve, with the source of defaults and the ownership of each prop made explicit.

Use the React adapter's public props, slots, additive providers, stable-value helpers, and factories. A React design-system integration does not need direct engine imports. Engine and shared core are public adapter-author packages whose documented exports follow semantic versioning from 3.0.0. A non-React adapter is a different project: it consumes syntax trees directly, depends on matching exact core and engine versions, and takes responsibility for its own rendering lifecycle. The [Vue adapter](../reference/vue.md) is the existing second-framework implementation; use its public components for a Vue UI integration.

## The extension points, at a glance

| Extension point                                    | What it carries                                                                   | Transport                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Wrapper **behavior groups** (e.g. `codeBlock`)     | Component behavior parameters — runtime-switchable, cost = leaf re-render         | Flat prop on your wrapper → `AIMarkdownBehaviorsProvider` → your narrow hook                                     |
| **State groups**                                   | Extension message-lifecycle states (aborted, reasoning, tool-call-in-progress, …) | `AIMarkdownStateProvider` → read via `useAIMarkdownState()`                                                      |
| `Typography` / `ExtraStyles` / `customComponents`  | Design-system rendering                                                           | Defaulted via destructuring, forwarded as ordinary props                                                         |
| `enginePlugins`                                    | **Curation only** — bundle default sets, filter, facade sugar                     | Forwarded prop; new parse-level capability goes through an upstream PR to the engine and its adapter integration |
| Engine payloads (`sanitizeSchema`, preprocessors…) | Pipeline inputs your features may depend on                                       | Forwarded prop; declare an injection policy per payload (see Step 6)                                             |

Two contracts govern the state-group channel:

- **Frequency contract**: state groups must be message-lifecycle frequency (flips per stream start/end, per abort, per tool call). Frame-rate data (per-token progress etc.) goes through metadata's stable-container pattern instead.
- **Built-in prop locks**: outer Providers can never touch built-in keys (`streaming` for state; `blockMemo` / `incrementalParse` / `preserveOrphanReferences` for behaviors). Three locks enforce this: the Provider `value` type marks built-in keys `never` (compile error), the React adapter's innermost merge unconditionally overwrites them (spread order), and dev builds warn when an outer value carries one.

The sealed `enginePlugins` set is a deliberate boundary: the incremental engine's boundary scanner must know every construct's syntax, so open plugin injection would void its verification record. Wrappers curate; engine defines the verified pipeline and the React adapter exposes its sealed catalog. Third-party _content_ extension stays open through `contentPreprocessors` + `customComponents`.

---

## The Mantine model

```text
@ai-markdown/react-mantine
├── MantineAIMarkdown (wrapper component)
│   ├── Typography = MantineAIMarkdownTypography     ← Mantine <Typography> wrapper
│   ├── ExtraStyles = MantineAIMDefaultExtraStyles   ← CSS scoping for em-based tokens
│   ├── customComponents.pre = MantineAIMPreCode     ← CodeHighlight + Mermaid + JSON pretty-print
│   ├── codeBlock prop → AIMarkdownBehaviorsProvider ← the wrapper's behavior group
│   └── colorScheme = Mantine's useComputedColorScheme (when not overridden)
│
├── defs.tsx
│   ├── MantineCodeBlockOptions + defaultMantineCodeBlockOptions
│   └── MantineAIMarkdownMetadata (extends AIMarkdownMetadata)
│
├── define.ts
│   └── defineMantineBehaviors (widened factory: built-in behavior fields + codeBlock)
│
└── hooks/
    ├── useMantineCodeBlockOptions   (THE single assertion + defaults site for the group)
    └── useMantineAIMarkdownMetadata
```

Every piece composes existing React adapter APIs — there's no special "extension API." Your sub-package can follow the same shape, swapping Mantine for your design system.

---

## Step 1: Define your behavior group

A group is a plain interface plus frozen defaults. No config-object extension, no React adapter defaults spread in — the group is self-contained:

```ts
// packages/your-integration/src/defs.ts
import type { AIMarkdownMetadata } from '@ai-markdown/react';

export interface YourCodeBlockOptions {
  showCopyButton: boolean;
  defaultLanguage: string;
}

/** Shipped defaults — applied inside the narrow hook (Step 3), nowhere else. */
export const defaultYourCodeBlockOptions: Readonly<YourCodeBlockOptions> = Object.freeze({
  showCopyButton: true,
  defaultLanguage: 'plaintext',
});

export interface YourAIMarkdownMetadata extends AIMarkdownMetadata {
  // Extension point — keep empty or add integration-specific fields.
}
```

Before naming group _prop_ fields, check the prop-name registry — the props table in the [React reference](../reference/react.md#props-api-reference): flat props share one namespace across the React adapter and all wrapper layers (see [Footguns](#footguns)).

---

## Step 2: Build the wrapper component

The wrapper does four jobs: default the slot components, merge `customComponents`, run its own stability firewall for the props it terminates, and contribute its group through the additive Provider. This mirrors `packages/react-mantine/src/MantineAIMarkdown.tsx`:

```tsx
// packages/your-integration/src/YourAIMarkdown.tsx
import { memo, useMemo } from 'react';
import AIMarkdown, {
  type AIMarkdownProps,
  type AIMarkdownCustomComponents,
  type AIMarkdownBehaviorGroups,
  type AIMarkdownStabilityTable,
  AIMarkdownBehaviorsProvider,
  AIMarkdownStabilityPolicy,
  useStableRecord,
  useStableValue,
} from '@ai-markdown/react';

import YourTypography from './components/Typography';
import YourExtraStyles from './components/ExtraStyles';
import YourPreCode from './components/PreCode';
import type { YourAIMarkdownMetadata, YourCodeBlockOptions } from './defs';

export interface YourAIMarkdownProps<
  TMetadata extends YourAIMarkdownMetadata = YourAIMarkdownMetadata,
> extends AIMarkdownProps<TMetadata> {
  /** Your behavior group. Atomic replacement; defaults applied inside the narrow hook. */
  codeBlock?: Partial<YourCodeBlockOptions>;
}

/**
 * Stable empty CONTRIBUTION for the absent-prop case. Deliberately carries
 * no `codeBlock` key: contributing `codeBlock: {}` would shadow a group
 * provided by an outer app-level Provider (inner-wins merge) even though
 * your wrapper has nothing to say.
 */
const NO_GROUPS: AIMarkdownBehaviorGroups = Object.freeze({});

/**
 * Your stability-firewall table — rows ONLY for object props this wrapper
 * TERMINATES (consumes in its own machinery). Forwarded object props ride
 * the React adapter's firewall untouched; derived values (the merged `customComponents`
 * below) are caught by the React adapter's wall.
 */
const STABILITY_TABLE: AIMarkdownStabilityTable<{
  codeBlock: Partial<YourCodeBlockOptions> | undefined;
}> = {
  codeBlock: AIMarkdownStabilityPolicy.DEEP_EQUAL,
};

const DEFAULT_COMPONENTS: AIMarkdownCustomComponents = {
  pre: YourPreCode,
  // …add more if your integration overrides other elements
};

const YourAIMarkdownComponent = <TMetadata extends YourAIMarkdownMetadata = YourAIMarkdownMetadata>({
  Typography = YourTypography,
  ExtraStyles = YourExtraStyles,
  customComponents,
  codeBlock,
  ...rest
}: YourAIMarkdownProps<TMetadata>) => {
  const stableCustomComponents = useStableValue(customComponents);

  // Merge: caller overrides win over your defaults.
  const usedComponents = useMemo(
    () => (stableCustomComponents ? { ...DEFAULT_COMPONENTS, ...stableCustomComponents } : DEFAULT_COMPONENTS),
    [stableCustomComponents]
  );

  // Your firewall: `codeBlock` is terminated here (it feeds the Provider
  // below, not the React prop surface).
  const stable = useStableRecord({ codeBlock }, STABILITY_TABLE);

  // Contribute the group through the additive behaviors Provider — firewall
  // output used directly, record identity memoized so the context value
  // stays stable across unrelated re-renders. `null`/absent prop ≡ NO
  // contribution (not an empty group): an outer app-level Provider's group
  // stays visible; when the prop IS present, inner-wins gives it precedence.
  const behaviorGroups = useMemo<AIMarkdownBehaviorGroups>(
    () => (stable.codeBlock != null ? { codeBlock: stable.codeBlock } : NO_GROUPS),
    [stable.codeBlock]
  );

  return (
    <AIMarkdownBehaviorsProvider value={behaviorGroups}>
      <AIMarkdown<TMetadata>
        Typography={Typography}
        ExtraStyles={ExtraStyles}
        customComponents={usedComponents}
        {...rest}
      />
    </AIMarkdownBehaviorsProvider>
  );
};

export const YourAIMarkdown = memo(YourAIMarkdownComponent) as typeof YourAIMarkdownComponent & {
  displayName?: string;
};
YourAIMarkdown.displayName = 'YourAIMarkdown';
export default YourAIMarkdown as typeof YourAIMarkdownComponent;
```

**Key points**:

- The Provider stacks **outside** `<AIMarkdown>`. The React adapter's innermost provider reads your outer context and provides `{ ...outer, ...coreResolved }` downward — consumers see exactly one behaviors context, and built-in keys always win.
- Own scalar props default via destructuring parameters, strip via rest destructuring, forward `{...rest}`. The rest object's identity needs no stabilization — JSX spread flattens to individual props and React compares them individually.
- Firewall rule: your `useStableRecord` table holds **only props you terminate** (mantine today: one row, `codeBlock`). Forwarded props are never touched — each prop is stabilized exactly once, at the layer that consumes it.
- Wrap with `memo`; merge `customComponents` with caller-wins spread order (`{ ...DEFAULT_COMPONENTS, ...callerComponents }`).

---

## Step 3: The narrow hook — the single assertion + defaults site

`useAIMarkdownBehaviors()` is non-generic and returns the built-in switches plus an opaque extension record. Your narrow hook is where the type assertion happens (exactly once) and where group defaults are applied (exactly once):

```ts
// packages/your-integration/src/hooks/useYourCodeBlockOptions.ts
import { useMemo } from 'react';
import { useAIMarkdownBehaviors } from '@ai-markdown/react';
import { defaultYourCodeBlockOptions, type YourCodeBlockOptions } from '../defs';

export function useYourCodeBlockOptions(): Required<YourCodeBlockOptions> {
  const behaviors = useAIMarkdownBehaviors();
  // The single assertion: the `codeBlock` group key is owned by this package,
  // contributed by `YourAIMarkdown` via its behaviors Provider.
  const group = behaviors.codeBlock as Partial<YourCodeBlockOptions> | undefined;
  return useMemo(
    () => ({
      showCopyButton: group?.showCopyButton ?? defaultYourCodeBlockOptions.showCopyButton,
      defaultLanguage: group?.defaultLanguage ?? defaultYourCodeBlockOptions.defaultLanguage,
    }),
    [group]
  );
}
```

This example treats nullish fields as absent. Define this policy deliberately: a simple object spread lets an explicit `undefined` erase a default. Mantine skips undefined fields and separately validates its numeric highlight interval.

Group values replace atomically at the transport layer; a partial group (`codeBlock={{ showCopyButton: false }}`) resolves its omitted fields to the shipped defaults here. Read sites must consume this hook and never re-apply defaults with bare `??` (see [Footguns](#footguns)).

The metadata hook is the same one-liner it always was:

```ts
// packages/your-integration/src/hooks/useYourMetadata.ts
import { useAIMarkdownMetadata } from '@ai-markdown/react';
import type { YourAIMarkdownMetadata } from '../defs';

export const useYourMetadata = () => useAIMarkdownMetadata<YourAIMarkdownMetadata>();
```

---

## Step 4: The widened `define*` factory

React adapter factories accept built-in fields only — passing `codeBlock` to the React adapter's `defineBehaviors` is a TS error. The widened factory is your one-line obligation (mirrors `packages/react-mantine/src/define.ts`):

```ts
// packages/your-integration/src/define.ts
import type { AIMarkdownBehaviorProps } from '@ai-markdown/react';
import type { YourCodeBlockOptions } from './defs';

export interface YourBehaviorProps extends AIMarkdownBehaviorProps {
  codeBlock?: Partial<YourCodeBlockOptions>;
}

/** Identity + your types + freeze; zero logic. */
export function defineYourBehaviors(values: YourBehaviorProps): Readonly<YourBehaviorProps> {
  return Object.freeze(values);
}
```

Consumers spread the frozen fragment; runtime-varying fields go after the spreads (later props win):

```tsx
const BEHAVIORS = defineYourBehaviors({ blockMemo: true, codeBlock: { showCopyButton: false } });

<YourAIMarkdown content={content} {...BEHAVIORS} streaming={!done} />;
```

---

## Step 5: Design-system components

### Typography wrapper

```tsx
// packages/your-integration/src/components/Typography.tsx
import type { AIMarkdownTypographyComponent } from '@ai-markdown/react';
import { Box, useTheme } from 'your-design-system';

const YourTypography: AIMarkdownTypographyComponent = ({ children, fontSize, variant, colorScheme, style }) => {
  const theme = useTheme();
  return (
    <Box
      data-variant={variant}
      data-color-scheme={colorScheme}
      style={{
        fontSize,
        fontFamily: theme.fonts.body,
        ...style, // ← MUST spread style for --aim-font-size-root to reach descendants
      }}
    >
      {children}
    </Box>
  );
};

export default YourTypography;
```

See [Custom Typography](custom-typography.md) for the full Typography contract, including why `style` must be spread.

### Extra-styles wrapper

```tsx
// packages/your-integration/src/components/ExtraStyles.tsx
import type { AIMarkdownExtraStylesComponent } from '@ai-markdown/react';

const YourExtraStyles: AIMarkdownExtraStylesComponent = ({ children }) => (
  <div className="your-integration-scope">{children}</div>
);

export default YourExtraStyles;
```

Ship a corresponding CSS file with selectors under `.your-integration-scope` for any em-based or theme-aware overrides specific to your design system.

### The pre/code component (if you override code blocks)

A `pre` override receives both rendered children and the hast node. Inspect the node before replacing the element. Markdown fences normally produce one `<code>` child with text children; arbitrary raw HTML may have a different shape or attributes your highlighter cannot preserve.

```tsx
// packages/your-integration/src/components/PreCode.tsx
import type { ComponentProps } from 'react';
import type { Element } from 'hast';
import { useAIMarkdownState } from '@ai-markdown/react';
import { useYourCodeBlockOptions } from '../hooks/useYourCodeBlockOptions';
import YourHighlightedBlock from './HighlightedBlock';
import YourMermaidBlock from './MermaidBlock';
import YourJsonBlock from './JsonBlock';

type PreProps = ComponentProps<'pre'> & {
  node?: Element;
};

function YourPreCode({ node, children, ...props }: PreProps) {
  const { streaming } = useAIMarkdownState();
  const { showCopyButton, defaultLanguage } = useYourCodeBlockOptions();
  const code = node?.children.length === 1 ? node.children[0] : undefined;
  if (
    !node ||
    Object.keys(node.properties).length !== 0 ||
    code?.type !== 'element' ||
    code.tagName !== 'code' ||
    !node.position ||
    !code.position ||
    Object.keys(code.properties).some((key) => key !== 'className') ||
    code.children.some((child) => child.type !== 'text')
  ) {
    return <pre {...props}>{children}</pre>;
  }
  const classes = code.properties.className;
  if (
    classes != null &&
    (!Array.isArray(classes) || classes.some((c) => typeof c !== 'string' || !c.startsWith('language-')))
  )
    return <pre {...props}>{children}</pre>;

  const language = Array.isArray(classes)
    ? classes.find((c): c is string => typeof c === 'string')?.slice('language-'.length)
    : undefined;
  const source = code.children.map((child) => (child.type === 'text' ? child.value : '')).join('');

  if (language === 'mermaid') return <YourMermaidBlock source={source} />;
  if (language === 'json') return <YourJsonBlock source={source} />;
  return (
    <YourHighlightedBlock
      source={source}
      language={language ?? defaultLanguage}
      showCopy={!streaming && showCopyButton}
    />
  );
}

export default YourPreCode;
```

Declare `@types/hast` as a development dependency (and make it available to consumers if your emitted declarations expose it). The `node` prop is renderer metadata and must not be spread onto the DOM element.

The three presentation components are integration-owned modules. Their `source` is the exact code text, including its trailing newline. Derive a separate display string if you format JSON or hide a final blank line; the copy action should retain the original. Do not call `trimEnd()` on your only copy of the source.

Both hooks run unconditionally before shape checks. State and behaviors use separate contexts, so a streaming transition wakes this component without forcing behavior-only consumers to update. Put copy buttons and toolbars outside the actual `<pre>` so fallback DOM text extraction does not include their labels.

## Step 6: Payload policy (declare it per payload)

For each engine payload (`contentPreprocessors`, `urlTransform`, `sanitizeSchema`, `customComponents`), pick one of two stances and write it into your package contract:

- **Your features depend on it** → inject unconditionally. For `contentPreprocessors`, fix and document the injection position (prepend or append — order is semantics).
- **Everything else** → the user's value wins wholesale, and you export your raw materials for manual composition.

The mantine example of the second stance: mantine does not inject schema material silently, so a consumer who wholesale-replaces `sanitizeSchema` without rebuilding it via `extendSanitizeSchema` silently disables the features that depend on the default schema's invariants (cross-chunk placeholders, KaTeX class names). Document your equivalent footgun.

If you ship a perf-flavored switch of your own (a hypothetical `mermaid.lazyRender`), it does not inherit the React adapter's byte-equivalence guarantee — self-certify an equivalence contract in your own docs.

---

## Step 7: Index / barrel exports

```ts
// packages/your-integration/src/index.ts
export type { YourAIMarkdownProps } from './YourAIMarkdown';
export { default } from './YourAIMarkdown';
export { default as YourTypography } from './components/Typography';
export { default as YourExtraStyles } from './components/ExtraStyles';
export type { YourAIMarkdownMetadata, YourCodeBlockOptions } from './defs';
export { defaultYourCodeBlockOptions } from './defs';
export { useYourCodeBlockOptions } from './hooks/useYourCodeBlockOptions';
export { useYourMetadata } from './hooks/useYourMetadata';
export { defineYourBehaviors } from './define';
export type { YourBehaviorProps } from './define';
```

Match the shape of `@ai-markdown/react-mantine`'s barrel for consistency. Re-export the typography and extra-styles components so consumers can wrap or compose them.

---

## Step 8: Peer dependencies

```jsonc
// packages/your-integration/package.json
{
  "peerDependencies": {
    "@ai-markdown/react": "^3.0.2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "your-design-system": "^1.0.0",
  },
  "dependencies": {
    // Direct deps your integration needs (e.g. a mermaid library, a syntax highlighter)
  },
}
```

Keep `@ai-markdown/react` as a **peer** dep — never a direct dep. Otherwise consumers can end up with two copies of the React adapter in their bundle, and the React context identity check fails (silent breakage: hooks find no provider).

---

## Step 9: Use it

```tsx
import YourAIMarkdown from '@yourorg/ai-markdown-yourds';
import { YourDesignSystemProvider } from 'your-design-system';

function App() {
  return (
    <YourDesignSystemProvider>
      <YourAIMarkdown content="Hello **world**!" codeBlock={{ showCopyButton: false }} />
    </YourDesignSystemProvider>
  );
}
```

Consumers do not need to manage shared core or engine — they install your package and the Mantine-style "drop in" experience is preserved.

---

## Third-level extension: apps stacking their own Provider

The additive Providers are not wrapper-exclusive. An application built on your wrapper (or on the React adapter directly) can stack its own groups outside the component tree it renders:

```tsx
import { AIMarkdownBehaviorsProvider, AIMarkdownStateProvider } from '@ai-markdown/react';

// Integration-time groups: module scope.
const APP_BEHAVIORS = { chatPanel: { compactQuotes: true } };

function ChatMessage({ content, aborted, toolCallInProgress }: ChatMessageProps) {
  // Runtime state groups: memoized so the context value keeps its identity.
  const lifecycleGroups = useMemo(
    () => ({ lifecycle: { aborted, toolCallInProgress } }),
    [aborted, toolCallInProgress]
  );
  return (
    <AIMarkdownStateProvider value={lifecycleGroups}>
      <AIMarkdownBehaviorsProvider value={APP_BEHAVIORS}>
        <YourAIMarkdown content={content} />
      </AIMarkdownBehaviorsProvider>
    </AIMarkdownStateProvider>
  );
}
```

Multi-level stacks merge naturally — for a duplicated group key the inner layer wins. The same rules apply at every level: built-in keys are locked (three locks, above), state groups obey the message-lifecycle frequency contract, values should be firewall/`useMemo` output so the context value keeps its identity, and the app should read its groups through its own narrow hook. Only behaviors and state are stackable; the theme context is reserved (mechanism exists, enabled on first real demand), document is closed (its payload is derived invariants — a forgeable `clobberPrefix` breaks the anchor system), and metadata doesn't need a Provider (wrappers merge at the prop layer).

Known cost: within one context, group invalidation is not isolated — one group change leaf-re-renders all subscribers of that context. Acceptable at current scale; a party needing isolation may run a private context as an escape hatch (both approaches are legal simultaneously).

---

## Tips from the Mantine integration

| Practice                                                                                                | Why                                                                                           |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `useStableRecord` with a table for the object props you terminate; `useStableValue` before merging      | A new merged object every render flushes the block-memo cache                                 |
| Auto-detect color scheme from your design system if not overridden                                      | Match the surrounding UI without explicit prop                                                |
| Ship a CSS file that overrides design-system spacing/font tokens to em-based units inside `ExtraStyles` | Markdown should scale with `fontSize` regardless of the design system's absolute tokens       |
| Keep `mermaid` (or whichever heavy lib) as a **direct** dep, not peer                                   | Consumers shouldn't have to install it separately for a feature they enabled via your package |
| Memo the wrapper at the top level                                                                       | Standard React perf hygiene                                                                   |

---

## What to avoid

### Re-implementing the pipeline

Don't fork `MarkdownContent` or the remark/rehype plugin chain. The the React adapter's pipeline is the value you're building on; bypassing it loses cross-chunk coordination, block memoization, LaTeX preprocessing, sanitization, and CJK handling. Compose at the public extension points instead.

### Trying to inject engine plugins

`enginePlugins` accepts React-exported sealed plugin objects only — the seal is a `unique symbol` brand you cannot construct. This is deliberate: the incremental engine's verification record (fuzz suites, byte equivalence) covers a closed construct set. Your curation rights: bundle default sets, filter (`defaultEnginePlugins.filter(...)`), facade sugar. If your integration needs a new parse-level construct, open an upstream PR to the engine and its adapter integration — that's the priced tradeoff, stated plainly.

### Choosing the peer version of `@ai-markdown/react`

For stable v3, use `^3.0.0` for the React adapter peer when your integration uses APIs available in 3.0.0. When following Mantine’s package configuration, match its [declared React peer range](../reference/react-mantine.md#peer-dependencies). Raise the minimum when using APIs introduced later, and validate the supported range in consumer tests. If explicitly testing a prerelease, match that candidate exactly. A legacy `^2.13.2` range cannot resolve the new package train.

### Re-exporting internal React adapter types

Stick to `AIMarkdownProps`, `AIMarkdownCustomComponents`, `AIMarkdownTypographyComponent`, `AIMarkdownStabilityTable`, etc. — the documented public surface. If your integration needs something internal-looking, that's a signal to either request the export upstream or work around it.

### Forgetting to test cross-chunk coordination

`<AIMarkdownDocuments>` works through `<YourAIMarkdown>` transparently — but the test that verifies this should live in your package. The Mantine test suite has equivalents; mirror them.

---

## Footguns

### Re-applying group defaults at read sites

Group defaults live inside your narrow hook, exactly once. A component that reads `behaviors.codeBlock` directly and patches holes with bare `??` duplicates the defaults — and when the shipped default changes, the read sites drift apart silently. Every read goes through the hook.

### Prop-name collisions

Flat props share one namespace across the React adapter and all wrapper layers. Check the prop-name registry — the props table in the [React reference](../reference/react.md#props-api-reference) — before adding a field to your wrapper props. A collision is a compile error at the `extends` site for TS consumers — but a **silent override** for plain-JS consumers. Same discipline for group keys inside the Provider value: check the [group-key registry](api/react-hooks.md#group-key-registry) and register your wrapper's keys there via PR — group keys share one namespace per context and a duplicated key resolves by inner-wins silently. Application-local groups should use app-scoped names (`chatPanel`, not `panel`).

### Wholesale-replacing `sanitizeSchema`

A consumer (or your wrapper) that passes a hand-built `sanitizeSchema` replaces the library's schema atomically — there is no library-side merging. Without the default schema's material, cross-chunk placeholders and KaTeX class names are silently stripped. Always build schemas with `extendSanitizeSchema` (it starts from a deep clone of the default, invariants included), and say so in your README.

---

## Distribution

Publishing a `@yourorg/ai-markdown-…` package is the natural unit of distribution. There's no central "integration registry" — discoverability is through npm keywords, your README, and the broader ai-markdown community (link to your package in the parent project's discussion forum or via a PR adding a row to a hypothetical integrations table).

When you publish, consider:

- A README following the structure of `@ai-markdown/react-mantine`.
- A peer-dep statement that's permissive enough (`^19.0.0` for React and React DOM, and `^3.0.0` for an integration using the stable 3.0.0 adapter APIs).
- npm keywords: `react`, `markdown`, `ai`, `llm`, `<your-design-system>`, `ai-markdown-integration`.
- Bundle size disclosure (bundlephobia badges).

Optionally, propose to add a row to the parent project's "Integrations" section if/when one exists.

## Validate the published integration contract

Before publishing, exercise the wrapper through its public entry point. Confirm caller component overrides win, an absent behavior group allows an outer provider through, a present partial group replaces the outer group, and omitted fields resolve once inside the narrow hook. Test explicit `false`, explicit `undefined`, and the null policy you document.

Render both a standalone document and two coordinated chunks, including a reference defined later. Check an ordinary code fence, raw `<pre>` with attributes, an incomplete streaming fence, a final complete block, and a copy action that preserves trailing whitespace. Theme changes and streaming completion should update presentation without requiring a new Markdown string.

Finally inspect packed ESM/CJS entry points, emitted types, stylesheet exports, peer ranges, and `sideEffects` declarations. Your README should name required providers and CSS imports, explain lazy assets, list every public helper, and link to the React adapter for inherited props. The package's defaults and copy policy should be testable statements rather than assumptions about how a design-system component happens to work.
