import type { CSSProperties } from 'react';
import '../../src/components/typography/variants/all.scss';
import AIMarkdown, { defaultUrlTransform, extendSanitizeSchema, type UrlTransform } from '../../src/index';
import { ThemedAIMarkdown } from '../_shared/ThemedAIMarkdown';
import { useStoryColorScheme, PAGE_PALETTE } from '@ai-markdown/storybook-kit/react/colorScheme';
import { SideBySide } from '@ai-markdown/storybook-kit/react/layouts';
import { baseReactMeta, type ReactMeta, type ReactStory } from '../_shared/meta';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
import { URL_SCHEMES_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import { getStreamingTheme } from '@ai-markdown/storybook-kit/react/theme';

/**
 * What the two URL gates do to a link, and what it takes to get a private
 * scheme past both of them.
 */
const meta: ReactMeta = {
  ...baseReactMeta,
  title: 'Customization/URL Sanitization',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content'] },
    docs: {
      description: {
        component: [
          'Markdown written by a model is untrusted input, and `[click](javascript:…)` is',
          'the cheapest XSS there is. Every URL the renderer emits therefore passes two',
          'independent protocol allowlists:',
          '',
          '1. **Gate 1 — the sanitize schema.** `rehype-sanitize` runs inside the rehype',
          '   chain, during parsing. A URL on a protocol it does not allow loses its',
          '   attribute right there.',
          '2. **Gate 2 — `urlTransform`.** A per-attribute rewriter that runs later, at',
          '   render time, and can rewrite or drop whatever survived Gate 1.',
          '',
          'The default URL transform allows `http`, `https`, `irc`, `ircs`, `mailto`',
          'and `xmpp`, plus relative URLs and fragments. The sanitizer has separate',
          'allowlists per attribute, so an allowed link scheme need not be an allowed',
          'image scheme. Both stages must permit the final attribute.',
          '',
          '**A URL needs both gates to render, and Gate 1 runs first.** That ordering is',
          'the single most common source of confusion: extending only `urlTransform` for a',
          'private scheme changes nothing, because Gate 1 already removed the attribute',
          'before Gate 2 was ever called. The `AllowCustomScheme` story shows exactly that,',
          'side by side with the working configuration.',
          '',
          `See ${docsLink('url-sanitization', 'URL sanitization & custom schemes')} for the full recipe,`,
          'including the regex-escaping trap in scheme names that contain `+`, `-`, or `.`.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** What the default pipeline was observed to do, scheme by scheme. */
const OBSERVED: readonly (readonly [string, string, string])[] = [
  ['https://…', 'renders as a link', 'on the default allowlist'],
  ['./relative.md', 'renders as a link', 'no protocol to check'],
  ['#fragment', 'renders as a link', 'rewritten to the document-scoped id (inert: headings get no ids)'],
  ['mailto:…', 'renders as a link', 'on the default allowlist'],
  ['javascript:…', 'text kept, href absent', 'dropped at Gate 1'],
  ['data:…', 'text kept, href absent', 'dropped at Gate 1'],
  ['app://…', 'text kept, href absent', 'dropped at Gate 1 — opt in below'],
  ['myapp:…', 'text kept, href absent', 'dropped at Gate 1 — opt in below'],
];

/**
 * The observed outcomes as a plain grid. Written from what the renderer
 * actually emits, not from the schema definition: a rejected URL does not
 * become `href=""` — the attribute is **absent**, which is what strips the
 * element of its link behavior.
 */
const ObservedTable = () => {
  const scheme = useStoryColorScheme();
  const theme = getStreamingTheme(scheme);
  const cell: CSSProperties = {
    borderBottom: `1px solid ${theme.panelBorder}`,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12,
    padding: '6px 8px',
    textAlign: 'left',
  };
  return (
    <table style={{ borderCollapse: 'collapse', color: PAGE_PALETTE[scheme].text, marginTop: 16, width: '100%' }}>
      <thead>
        <tr>
          <th style={{ ...cell, color: theme.textMuted }}>URL in the markdown</th>
          <th style={{ ...cell, color: theme.textMuted }}>What renders</th>
          <th style={{ ...cell, color: theme.textMuted }}>Why</th>
        </tr>
      </thead>
      <tbody>
        {OBSERVED.map(([url, renders, why]) => (
          <tr key={url}>
            <td style={cell}>{url}</td>
            <td style={cell}>{renders}</td>
            <td style={{ ...cell, color: theme.textMuted }}>{why}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/**
 * Every scheme worth testing, rendered with no configuration at all. Hover the
 * links or read them with the DOM inspector: the four allowed ones carry an
 * `href`, and the four rejected ones are anchors with **no `href` attribute**.
 *
 * That distinction matters more than it looks. The rejected entries are not
 * empty links or dead `href="#"` stubs — an `<a>` without an `href` is not a
 * link at all. It is not clickable, not focusable by keyboard, and carries no
 * link role in the accessibility tree; hovering it shows the plain text
 * cursor rather than the pointer.
 *
 * One honest caveat: it still *looks* like a link. The default stylesheet
 * colours `a`, not `a[href]`, so a rejected entry keeps the anchor blue while
 * having none of the behavior. If that matters for your content, style
 * `a:not([href])` yourself — the library deliberately drops the destination
 * rather than the text, so the prose stays readable, and does not editorialize
 * about how the leftover should look.
 *
 * The fragment link is the one entry that is neither passed through nor
 * dropped: it is rewritten to a document-scoped id so that two answers on the
 * same page cannot cross-link into each other's headings. Today the rewritten
 * anchor has nowhere to land — the renderer rewrites hash *links* but does not
 * emit ids on headings — so the link is safe yet inert. Footnote anchors are
 * the exception: those ids are emitted, and the same rewrite makes them work.
 */
export const DefaultPolicy: ReactStory = {
  args: { content: URL_SCHEMES_DOC },
  render: (args) => (
    <div>
      <ThemedAIMarkdown content={args.content ?? ''} />
      <ObservedTable />
    </div>
  ),
};

/**
 * Gate 2 only. `urlTransform` lets `app://` through and delegates everything
 * else to `defaultUrlTransform`, which is the recommended composition — and it
 * is not enough on its own.
 */
const URL_TRANSFORM: UrlTransform = (url, key, node) =>
  /^app:/i.test(url) ? url : defaultUrlTransform(url, key, node);

/**
 * Gate 1. `extendSanitizeSchema` mutates a copy of the library schema, so the
 * additions the library makes for `<mark>`, KaTeX markers, and the cross-chunk
 * placeholder tags all survive. Spreading `rehype-sanitize`'s own
 * `defaultSchema` instead would silently drop those.
 */
const SCHEMA = extendSanitizeSchema((s) => {
  s.protocols!.href!.push('app');
  s.protocols!.src!.push('app');
});

/**
 * The footgun and the fix, on one screen. Both panels render the same
 * document with the same `urlTransform`; only the right one also extends the
 * sanitize schema.
 *
 * **Left — `urlTransform` alone: the `app://` link is still dead.** The
 * transform is written correctly and never gets to prove it. Gate 1 removed
 * the `href` while the document was still being parsed, so by the time the
 * per-attribute rewriter runs there is no URL left to allow. Nothing warns
 * about this; the link simply keeps rendering as text, which is why the
 * mistake survives code review so often.
 *
 * **Right — both gates: the `app://` link works.** Same transform, plus a
 * schema that lists `app` under `protocols.href` and `protocols.src`.
 *
 * `myapp:` stays dead in both panels, and that is the control: it proves the
 * right panel opened exactly one scheme rather than disabling the allowlist.
 *
 * Both `URL_TRANSFORM` and `SCHEMA` are module constants. The schema is
 * deep-compared by the stability firewall and would survive an inline call,
 * but `urlTransform` is a function — deep-comparing closures is meaningless,
 * so it is `WARN_ONLY`, and an inline arrow discards the block-memo cache for
 * the whole document on every render. Development builds log a warning when
 * they catch it.
 */
export const AllowCustomScheme: ReactStory = {
  args: { content: URL_SCHEMES_DOC },
  render: (args) => (
    <SideBySide
      leftLabel="urlTransform only — app:// still dropped"
      rightLabel="urlTransform + sanitizeSchema — app:// renders"
      left={<ThemedAIMarkdown content={args.content ?? ''} urlTransform={URL_TRANSFORM} />}
      right={<ThemedAIMarkdown content={args.content ?? ''} urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />}
    />
  ),
};
