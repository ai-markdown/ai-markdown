import React from 'react';
import MantineAIMarkdown from '../src/index';
import { baseMantineMeta, type MantineMeta, type MantineStory } from './_shared/meta';
import { JSON_PAYLOAD_DOC, LONG_CODE_DOC, UNLABELED_CODE_DOC } from './_shared/fixtures';
import { CODE_SAMPLES_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import { SideBySide } from '@ai-markdown/storybook-kit/react/layouts';
import { docsLink } from '@ai-markdown/storybook-kit/common/docsLinks';

/**
 * What the Mantine package puts in place of core's plain `<pre>`.
 */
const meta: MantineMeta = {
  ...baseMantineMeta,
  title: 'Integrations/Mantine/Code Blocks',
  tags: ['autodocs'],
  component: MantineAIMarkdown,
  parameters: {
    // Trialled at 'error' and reverted: `color-contrast`, on the highlight.js
    // token colours themselves. The `atom-one-light` theme this Storybook
    // registers puts several token colours below 4.5:1 against the code
    // block's #f8f9fa background — measured at 3.04:1 for strings (#50a14f),
    // 3.84:1 for function names (#4078f2), 3.96:1 for literals (#0184bb).
    // That is the third-party theme's palette, not something a story about
    // code blocks can render its way out of, and every story in this file is
    // by definition full of highlighted tokens.
    a11y: { test: 'todo' },
    controls: { include: ['content', 'codeBlock', 'fontSize'] },
    docs: {
      description: {
        component: [
          'Core emits `<pre><code class="language-ts">` and stops there — it attaches no',
          'highlighter, because bundling one would make every consumer pay for a feature',
          'many of them already solve differently. The Mantine package fills that gap by',
          'overriding `pre` with a renderer built on `@mantine/code-highlight`, which adds',
          'syntax colouring, a copy button, a collapse control, and a tab strip carrying',
          'the language name.',
          '',
          '### Configuring it',
          '',
          'The options shown here, delivered as the `codeBlock` behavior group:',
          '',
          '| Option | Default | Effect |',
          '| --- | --- | --- |',
          '| `defaultExpanded` | `true` | `false` starts blocks collapsed at 320px with an expand button |',
          '| `autoDetectUnknownLanguage` | `false` | `true` names fences with no info string through `@ai-markdown/code-language-detector` |',
          '| `languageFormat` | `MantineLanguageFormat.HighlightJs` | Hands fence and detected languages to the highlighter in highlight.js names or, with `Shiki`, in Shiki names |',
          '',
          'The group replaces atomically — passing `codeBlock={{ defaultExpanded: false }}`',
          'leaves `autoDetectUnknownLanguage` at its shipped default rather than clearing',
          'it, because the defaults are applied at read time inside the hook rather than',
          'merged at the prop boundary.',
          '',
          'Three ways to set it, in increasing order of distance from the render call:',
          '',
          '```tsx',
          '// 1. Per render.',
          '<MantineAIMarkdown content={md} codeBlock={{ defaultExpanded: false }} />',
          '',
          '// 2. Packaged once, frozen, reused. `defineMantineBehaviors` is the widened',
          "//    factory — core's `defineBehaviors` rejects `codeBlock`, which is not a",
          '//    core field.',
          'const behaviors = defineMantineBehaviors({ codeBlock: { defaultExpanded: false } });',
          '<MantineAIMarkdown content={md} {...behaviors} />',
          '',
          '// 3. App-wide, via the additive Provider. A nested MantineAIMarkdown that',
          '//    passes its own `codeBlock` still wins.',
          '<AIMarkdownBehaviorsProvider value={{ codeBlock: { defaultExpanded: false } }}>',
          '```',
          '',
          'Your own components can read the resolved value with',
          '`useMantineCodeBlockOptions()`, which is the single place the defaults are',
          'applied — read the raw group off `useAIMarkdownBehaviors()` and you will end up',
          'maintaining a second copy of the defaults that drifts.',
          '',
          `See ${docsLink('extending-via-subpackage', 'extending via a subpackage')} for how a wrapper`,
          'contributes a behavior group of its own.',
        ].join('\n'),
      },
    },
  },
  render: (args) => <MantineAIMarkdown {...args} />,
};

export default meta;

/**
 * `defaultExpanded: false` caps every block at 320px and adds an expand
 * control to the top-right corner of the block.
 *
 * Click it and the block grows to its full height; the control flips to
 * "Collapse code". The state is per block and lives in the code-block
 * component, so expanding one block in a long answer leaves the others alone —
 * and re-rendering the document (a new streamed chunk, a theme flip) does not
 * reset what the reader opened.
 *
 * The `codeBlock` control in the panel is live. Set `defaultExpanded` back to
 * `true` and the cap disappears entirely; there is no expand button on an
 * already-expanded block that fits.
 */
export const CollapsedByDefault: MantineStory = {
  args: {
    content: LONG_CODE_DOC,
    codeBlock: { defaultExpanded: false },
  },
};

/**
 * The tab strip labels the block, and what it says is exactly the fence's info
 * string — not a filename parsed out of it.
 *
 * This is the part worth reading carefully, because the convention it looks
 * like is one it does not implement. Walking the fixture from the top:
 *
 * - **`ts` and `python`** — recognized by `highlight.js`. The tab shows the
 *   language name and the body is highlighted.
 * - **`json`** — recognized, and additionally pretty-printed (see the
 *   `JsonPrettyPrint` story).
 * - **`js:src/main.js`** — the whole string, colon and path included, becomes
 *   the `language-*` class, and the renderer looks *that* up in
 *   `highlight.js`. No language by that name exists, so the tab shows
 *   `js:src/main.js` verbatim and the body renders as **plaintext**. The
 *   `lang:filename` info string is a convention some other renderers support;
 *   this one does not split it, so a fence written that way silently loses its
 *   highlighting. Write ` ```js ` and put the path in the prose above the
 *   fence.
 * - **`wobbledy`** — same mechanism, less surprising outcome: unknown name,
 *   shown verbatim, plaintext body.
 * - **no info string** — no tab strip at all. That fence takes the other
 *   branch of the renderer entirely; the `UnknownLanguageFallback` story is
 *   about what can be done with it.
 */
export const LanguageTabs: MantineStory = {
  args: {
    content: CODE_SAMPLES_DOC,
  },
};

/**
 * A `json` fence is parsed and re-printed before display, so the minified
 * single line above arrives as an indented tree.
 *
 * It goes one level further than `JSON.parse` + `JSON.stringify`: the renderer
 * also expands *strings whose contents are themselves a JSON object or
 * array* (primitive-looking strings such as `"true"` or `"123"` are left as
 * written). Watch the `tool_result` field — in the source it is one
 * escaped string full of `\"`, and in the output it has become a real nested
 * object with its own indentation. Tool-call transcripts are full of that
 * shape, and it is the case where raw JSON is least readable.
 *
 * Two honest caveats. The pretty-printer only runs when the fence is labelled
 * `json`; an unlabelled blob of JSON stays exactly as written, even with
 * auto-detection on. And what is displayed is no longer byte-identical to the
 * source — the copy button hands over the reformatted text, which is what a
 * reader almost always wants but is worth knowing if you are copying a payload
 * whose whitespace matters.
 */
export const JsonPrettyPrint: MantineStory = {
  args: {
    content: JSON_PAYLOAD_DOC,
  },
};

/**
 * What happens to a fence with no info string, with the detector off and on.
 *
 * **Left, `autoDetectUnknownLanguage: false` (the default).** No language, so
 * no tab strip: the block renders through the plain `CodeHighlight` component
 * as unhighlighted monospace text. This is the conservative default — the
 * renderer says nothing about content it was told nothing about.
 *
 * **Right, `true`.** `@ai-markdown/code-language-detector` reads the sample
 * as Python, so the block gains a `python` tab and full token colouring. The
 * detector ships with the package and runs during render, so the label is
 * already in the server-rendered markup.
 *
 * The difference is plainly visible here because the sample is unambiguous
 * Python. The detector is built to abstain rather than guess: three lines of
 * shell or a config excerpt with no telling syntax stay unlabelled
 * plaintext, because a wrong guess colours the block as something it is not.
 * Turn it on when your content pipeline tends to drop info strings, and leave
 * it off when your model reliably emits them.
 */
/** Module constant: the group is compared by value. */
const AUTODETECT = { autoDetectUnknownLanguage: true };

export const UnknownLanguageFallback: MantineStory = {
  args: {
    content: UNLABELED_CODE_DOC,
  },
  parameters: {
    controls: { include: ['content'] },
  },
  render: (args) => (
    <SideBySide
      leftLabel="autoDetectUnknownLanguage: false — plaintext, no tab"
      rightLabel="autoDetectUnknownLanguage: true — detected as python"
      left={<MantineAIMarkdown {...args} codeBlock={{ autoDetectUnknownLanguage: false }} />}
      right={<MantineAIMarkdown {...args} codeBlock={AUTODETECT} />}
    />
  ),
};
