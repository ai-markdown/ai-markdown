import React, { type ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '../src/index';
import { baseMantineMeta, storyTheme, type MantineMeta, type MantineStory } from './_shared/meta';
import { SCHEME_SAMPLE_DOC } from './_shared/fixtures';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';
// The stylesheets normally arrive with `withMantineProvider`, which this file
// does not use. Importing them here keeps the story self-contained rather than
// dependent on some other Mantine story having been visited first.
import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import './globals.scss';

const highlightJsAdapter = createHighlightJsAdapter(hljs);

/**
 * How the wrapper decides which color scheme to render in.
 */
const meta: MantineMeta = {
  ...baseMantineMeta,
  title: 'Integrations/Mantine/Color Scheme',
  tags: ['autodocs'],
  component: MantineAIMarkdown,
  // No `withMantineProvider` here. Storybook decorators compose rather than
  // replace — a story cannot opt out of one its meta declares — and this
  // file's whole subject is what a component does under a provider it was
  // given. So the meta ships no decorator and each story brings its own.
  decorators: [],
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content'] },
    docs: {
      description: {
        component: [
          'The React adapter defaults `colorScheme` to `light`. The Mantine wrapper differs:',
          "when the prop is absent it calls Mantine's own `useComputedColorScheme()` and",
          'renders in whatever scheme the surrounding `MantineProvider` resolved to. An',
          'app that already has a working light/dark switch gets markdown that follows it',
          'with no extra wiring.',
          '',
          '```tsx',
          '// Follows the provider.',
          '<MantineAIMarkdown content={md} />',
          '',
          '// Pins the scheme regardless of the provider.',
          '<MantineAIMarkdown content={md} colorScheme="dark" />',
          '```',
          '',
          'The prop still wins when you pass it, which is what you want for a preview',
          'pane that has to stay dark inside a light application.',
          '',
          "Note that the resolution reads Mantine's React context, not the",
          '`data-mantine-color-scheme` attribute in the DOM. The two normally agree — the',
          'provider writes the attribute — but the context is the source of truth, so a',
          'nested provider changes what the markdown renders as even though the attribute',
          'above it is unchanged.',
          '',
          '### Where the colours actually come from',
          '',
          'Worth being precise about, because it is not what the React catalog would lead you',
          "to expect. The wrapper substitutes its own `Typography`, so core's typography",
          "root — and with it core's `--aim-*` token surface and its `.light` / `.dark`",
          'classes — is **not** in the tree at all. Prose colour, code-block backgrounds,',
          "table borders, and the blockquote rule are all Mantine's own CSS variables,",
          'driven by the same provider.',
          '',
          "The resolved scheme is still handed to core's theme context, and the wrapper's",
          'own renderers read it from there: it is what makes mermaid re-render with its',
          'dark palette and what sets the background on a diagram opened in a new tab.',
          '',
          `See ${docsLink('custom-typography', 'custom typography')} for what replacing the Typography`,
          'slot costs and how to get the token surface back if you want it.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * A Mantine root scoped to one element instead of to the document.
 *
 * `MantineProvider` normally writes `data-mantine-color-scheme` onto
 * `<html>` and declares its CSS variables on `:root`. Two providers doing that
 * at once on one page would fight over a single attribute, and the loser's
 * subtree would render in the winner's colours. Two changes make them
 * independent:
 *
 * - `getRootElement={() => undefined}` stops the provider from touching
 *   `<html>` at all. The attribute is written by this component instead, onto
 *   its own wrapper div.
 * - `cssVariablesSelector` re-homes the variable declarations from `:root` to
 *   that same div, so `--mantine-color-body` and the rest resolve per panel.
 *
 * Everything else — the markdown component, the code-block renderer, the
 * highlight.js theme, which is scoped by the same attribute — then follows
 * along without knowing anything special is happening.
 */
const ScopedMantineRoot = ({
  scheme,
  scopeClass,
  children,
}: {
  scheme: 'light' | 'dark';
  scopeClass: string;
  children: ReactNode;
}) => (
  <div
    className={scopeClass}
    data-mantine-color-scheme={scheme}
    style={{
      background: 'var(--mantine-color-body)',
      border: '1px solid var(--mantine-color-default-border)',
      borderRadius: 8,
      color: 'var(--mantine-color-text)',
      minWidth: 0,
      padding: 16,
    }}
  >
    <MantineProvider
      theme={storyTheme}
      forceColorScheme={scheme}
      cssVariablesSelector={`.${scopeClass}`}
      getRootElement={() => undefined}
    >
      <CodeHighlightAdapterProvider adapter={highlightJsAdapter}>{children}</CodeHighlightAdapterProvider>
    </MantineProvider>
  </div>
);

/**
 * Two panels, two providers, one document, and **no `colorScheme` prop
 * anywhere**. The left panel's provider is pinned to light and the right one to
 * dark; each `<MantineAIMarkdown>` resolves its own scheme from the provider
 * directly above it.
 *
 * Everything moves together: the prose colour, the code block's background and
 * its highlight.js palette, the table borders, the blockquote rule. All of it
 * resolves from Mantine's variables inside each scope — the wrapper is not
 * repainting anything, it is simply not fighting the provider it sits under.
 *
 * **The toolbar theme switch does not move these panels.** Try it: the rest of
 * the page inverts and the two panels stay exactly as they are, because
 * `forceColorScheme` pins each provider and the markdown follows its provider
 * rather than the toolbar. That is the demonstration — a component that read
 * some global would flip with the page.
 *
 * The mechanics of scoping two providers to one page are in
 * `ScopedMantineRoot` above; they are Mantine plumbing rather than anything
 * this library asks for, but you need them the moment you want two schemes
 * side by side, so they are written out rather than hidden.
 */
export const AutoFromProvider: MantineStory = {
  args: {
    content: SCHEME_SAMPLE_DOC,
  },
  render: (args) => (
    <div className="aim-scheme-panels">
      <style>
        {'.aim-scheme-panels { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }' +
          '@media (max-width: 720px) { .aim-scheme-panels { grid-template-columns: 1fr; } }'}
      </style>
      <ScopedMantineRoot scheme="light" scopeClass="aim-scheme-scope-light">
        <MantineAIMarkdown {...args} />
      </ScopedMantineRoot>
      <ScopedMantineRoot scheme="dark" scopeClass="aim-scheme-scope-dark">
        <MantineAIMarkdown {...args} />
      </ScopedMantineRoot>
    </div>
  ),
};
