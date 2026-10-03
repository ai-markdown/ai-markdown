import { useCallback, useState } from 'react';
import type { StoryObj } from '@storybook/react-vite';
import '../../src/components/typography/variants/all.scss';
import AIMarkdown from '../../src/index';
import { ThemedAIMarkdown } from '../_shared/ThemedAIMarkdown';
import { Labeled, SideBySide, TokenGrid } from '@ai-markdown/storybook-kit/react/layouts';
import { baseReactMeta, type ReactMeta, type ReactStory } from '../_shared/meta';
import { docsLink, REPO_URL } from '@ai-markdown/storybook-kit/common/docsLinks';
import { GFM_BASICS } from '@ai-markdown/storybook-kit/common/fixtures';

/**
 * The CSS custom properties the default typography variant is built from.
 */
const meta: ReactMeta = {
  ...baseReactMeta,
  title: 'Customization/Theming/Design Tokens',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    docs: {
      description: {
        component: [
          'The default variant declares 43 custom properties — spacing, font sizes,',
          'line heights, heading scale, radii, font families, and one colour set per',
          'scheme — and consumes a 44th, `--aim-font-size-root`, which the renderer',
          'writes inline from the `fontSize` prop. Nothing in the variant is an',
          'absolute length, so every dimension is derived from that one anchor.',
          '',
          'Retheming means overriding tokens in your own stylesheet; no JavaScript is',
          'involved. One thing to get right: the tokens are declared **on** the',
          '`.aim-typography-root.default` element, not on `:root`. A declaration on an',
          'ancestor therefore loses — the cascade beats inheritance — so an override',
          'has to match that element with at least equal specificity. The BrandOverride',
          'story below does exactly that, and its source is the pattern to copy.',
          '',
          `Full reference: ${docsLink('design-tokens', 'design tokens')}. The declarations`,
          `live in [\`packages/react/src/components/typography/variants/default.scss\`](${REPO_URL}/blob/main/packages/react/src/components/typography/variants/default.scss).`,
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** Ten tokens worth watching, module-level so the readout's identity is stable. */
const HEADLINE_TOKENS: readonly string[] = [
  '--aim-font-size-root',
  '--aim-h1-font-size',
  '--aim-line-height',
  '--aim-spacing-md',
  '--aim-radius-sm',
  '--aim-color-anchor',
  '--aim-color-border',
  '--aim-color-code-bg',
  '--aim-color-blockquote-bg',
  '--aim-color-mark-bg',
];

/**
 * Holds the rendered `.aim-typography-root` element so the token readout can
 * resolve values from inside the scope that declares them. The ref callback
 * runs after the children are committed, which is why the lookup works.
 */
const useTypographyRoot = () => {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const attach = useCallback(
    (node: HTMLDivElement | null) => setRoot(node?.querySelector<HTMLElement>('.aim-typography-root') ?? null),
    []
  );
  return { attach, root };
};

const TokenReadout = ({ content }: { content: string }) => {
  const { attach, root } = useTypographyRoot();
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <div ref={attach}>
        <ThemedAIMarkdown content={content} />
      </div>
      <Labeled label="resolved values, read from the rendered element">
        <TokenGrid tokens={HEADLINE_TOKENS} target={root} />
      </Labeled>
    </div>
  );
};

/**
 * The baseline document, with ten of its tokens read back out of the DOM
 * underneath it. The values come from `getComputedStyle` on the rendered
 * typography root rather than from a table typed out by hand, so they are
 * whatever the browser resolved a moment ago.
 *
 * Flip the theme in the toolbar and watch the colour rows change while the
 * spacing and size rows hold: the colour tokens are redeclared per scheme, the
 * geometry tokens are not.
 */
export const Defaults: ReactStory = {
  args: {
    content: GFM_BASICS,
  },
  parameters: {
    controls: { include: ['content'] },
  },
  render: (args) => <TokenReadout content={args.content ?? ''} />,
};

interface BrandArgs {
  anchorColor: string;
  borderColor: string;
  codeBackground: string;
  blockquoteBackground: string;
  headingScale: string;
  cornerRadius: string;
}

const BRAND_CLASS = 'aim-brand-override';

/**
 * The right-hand panel: the same component, wrapped in a class that carries a
 * more specific declaration of six tokens.
 *
 * The override arrives as a scoped stylesheet rather than as an inline style
 * on a wrapper `div`, and that is not a stylistic choice. Custom properties
 * are inherited, but the typography root declares these six itself, and a
 * declaration on the element always beats a value inherited from an ancestor.
 * Adding one class to the selector is the smallest thing that wins.
 */
const BrandPanel = ({ content, ...brand }: { content: string } & BrandArgs) => {
  const declarations = [
    `--aim-color-anchor: light-dark(${brand.anchorColor}, color-mix(in srgb, ${brand.anchorColor}, white 55%));`,
    `--aim-color-border: ${brand.borderColor};`,
    `--aim-color-code-bg: light-dark(${brand.codeBackground}, color-mix(in srgb, ${brand.codeBackground}, #161b22 90%));`,
    `--aim-color-blockquote-bg: light-dark(${brand.blockquoteBackground}, color-mix(in srgb, ${brand.blockquoteBackground}, #161b22 90%));`,
    `--aim-h1-font-size: ${brand.headingScale};`,
    `--aim-radius-sm: ${brand.cornerRadius};`,
  ].join(' ');
  return (
    <div className={BRAND_CLASS}>
      <style>{`.${BRAND_CLASS} .aim-typography-root.default { ${declarations} }`}</style>
      <ThemedAIMarkdown content={content} />
    </div>
  );
};

const BrandComparison = ({ content, ...brand }: { content: string } & BrandArgs) => (
  <SideBySide
    leftLabel="default tokens"
    rightLabel="six tokens overridden"
    left={<ThemedAIMarkdown content={content} />}
    right={<BrandPanel content={content} {...brand} />}
  />
);

/**
 * Six tokens rewritten, everything else inherited from the default variant.
 * Each one is a control — change a colour or a size and the right panel
 * follows while the left panel stays put.
 *
 * This is the whole retheming story. There is no theme object, no provider,
 * and no build step: a consumer ships one CSS rule matching
 * `.aim-typography-root.default` and the renderer picks it up. Read the story
 * source for the selector, which is the part that is easy to get wrong.
 */
export const BrandOverride: StoryObj<typeof BrandComparison> = {
  args: {
    content: GFM_BASICS,
    anchorColor: '#c2255c',
    borderColor: '#f3a8c4',
    codeBackground: '#fff0f6',
    blockquoteBackground: '#fff0f6',
    headingScale: 'calc(var(--aim-font-size-root) * 2.75)',
    cornerRadius: '0.5rem',
  },
  argTypes: {
    content: { control: 'text' },
    anchorColor: { control: 'color', description: '`--aim-color-anchor` — links.' },
    borderColor: { control: 'color', description: '`--aim-color-border` — table rules and thematic breaks.' },
    codeBackground: { control: 'color', description: '`--aim-color-code-bg` — code spans and fenced blocks.' },
    blockquoteBackground: { control: 'color', description: '`--aim-color-blockquote-bg`.' },
    headingScale: { control: 'text', description: '`--aim-h1-font-size` — any CSS length or `calc()`.' },
    cornerRadius: { control: 'text', description: '`--aim-radius-sm` — code and blockquote corners.' },
  },
  parameters: {
    controls: {
      include: [
        'content',
        'anchorColor',
        'borderColor',
        'codeBackground',
        'blockquoteBackground',
        'headingScale',
        'cornerRadius',
      ],
    },
  },
  render: (args) => <BrandComparison {...args} />,
};
