/**
 * TEST-ONLY pinned corpus for the boundary-diff harness and the conformance
 * oracles (two-model plan P1, verification protocol §2.3).
 *
 * The 17 realistic documents are FROZEN copies of the Storybook fixture
 * library (packages/core/stories/_shared/fixtures.ts) taken 2026-08-24. Do
 * not re-sync them: the diff harness compares boundary numbers across git
 * revisions, so the corpus must be byte-stable even while the living
 * fixtures evolve. The three fixture exports that are frames rather than
 * documents (ORPHAN_FOOTNOTE_CHUNK, BROKEN_TAIL_FRAME,
 * CJK_EMPHASIS_REGRESSION) are deliberately absent.
 *
 * Three REF_RESOLUTION docs are purpose-built, not fixture copies: the
 * fixture library contains ZERO link reference definitions (measured), so
 * only a thin sliver of fuzz samples (13 of 2000 under the §2.3
 * dropped-defs mutation) exercises freezing past a RESOLVED link ref.
 * These pin that path deterministically, by name.
 *
 * Four more purpose-built docs joined 2026-09-15 with the tab and tag-name
 * prefix generator axes (fuzzGenerators.ts): TAB_INDENT_DOC and
 * TAB_FENCE_TABLE_DOC carry U+0009 where it decides block structure (the
 * corpus had none), TAG_PREFIX_BLOCKS_DOC and TAG_PREFIX_TABLE_MIX_DOC
 * carry element names that share a prefix with a table part, a raw-text
 * name or a document-structure name. They are the freezable side of each
 * axis; the poisoning shapes are pinned in tabIndentAxis.test.ts and
 * tagNamePrefixAxis.test.ts, where equivalence-only is the right claim.
 *
 * The 2000 fuzz samples come from fast-check with a pinned seed. That is
 * deterministic for a FIXED fast-check version only, so every consumer must
 * verify `corpusFingerprint` before trusting a stored baseline: a
 * fingerprint mismatch means "regenerate the baseline", never
 * "interpret the diff".
 */

import fc from 'fast-check';

import { benignDocArb, hazardDocArb } from './fuzzGenerators';

export interface PinnedDoc {
  id: string;
  /** CATALOG index (mod length at the call site). */
  configIndex: number;
  doc: string;
}

export const REALISTIC_DOCS: PinnedDoc[] = [
  {
    id: 'GFM_BASICS',
    configIndex: 0,
    doc: '# Markdown basics\n\nA short document covering the syntax `@ai-react-markdown/core` handles out of\nthe box. Text can be *emphasized*, **strong**, ~~struck through~~, or marked as\n`inline code`.\n\n## Lists\n\n- Unordered item\n- Another item\n  - Nested one level\n\n1. First ordered item\n2. Second ordered item\n3. Third ordered item\n\n- [x] Task lists render as checkboxes\n- [ ] Unchecked items stay unchecked\n\n## Table\n\n| Prop               | Type      |   Default |\n| :----------------- | :-------: | --------: |\n| `content`          | `string`  |  required |\n| `streaming`        | `boolean` |   `false` |\n| `blockMemo`        | `boolean` |    `true` |\n\n## Quotes and links\n\n> Blockquotes carry **inline formatting** too.\n>\n> > And they nest.\n\nAutolinks resolve on their own: https://github.com/AIEPhoenix/ai-react-markdown\n\n---\n\nThat is the baseline. Everything else in this Storybook builds on it.',
  },
  {
    id: 'PROSE_SAMPLE',
    configIndex: 1,
    doc: '# Rendering pipeline\n\nThe renderer parses markdown to mdast, runs the selected engine plugins, and\nhands the result to React. Every dimension it draws is derived from a single\nanchor, `--aim-font-size-root`.\n\n## What scales\n\n- Headings, at their own multiple of the anchor\n- Vertical rhythm — the spacing scale is anchored the same way\n- Inline `code` spans and fenced blocks\n\n> Changing one prop rescales the whole document, because nothing in the\n> default variant is written as an absolute length.',
  },
  {
    id: 'TABLES_DOC',
    configIndex: 2,
    doc: '## Column alignment\n\nThe dashes in the delimiter row decide the alignment: a leading colon means\nleft, colons on both ends mean center, a trailing colon means right, and a\nbare run of dashes leaves the cell at its default.\n\n| Default    | Left        |   Center   |       Right |\n| ---------- | :---------- | :--------: | ----------: |\n| `content`  | `string`    |  required  |           — |\n| `fontSize` | `string`    |  optional  |  `0.9375rem` |\n| `streaming`| `boolean`   |  optional  |     `false` |\n\n## Formatting inside cells\n\n| Syntax          | Renders as                     |\n| :-------------- | :----------------------------- |\n| `**strong**`    | **strong**                     |\n| `` `code` ``    | `code`                         |\n| `~~struck~~`    | ~~struck~~                     |\n| `[a link](https://example.com)` | [a link](https://example.com) |',
  },
  {
    id: 'TASK_LIST_DOC',
    configIndex: 3,
    doc: '## Release checklist\n\n- [x] Freeze the branch\n- [x] Run the soak suite\n- [ ] Write the release notes\n  - [x] Collect the merged pull requests\n  - [ ] Summarize the breaking changes\n- [ ] Publish to npm\n\nTask items mix freely with ordinary list items:\n\n- [ ] An item with a checkbox\n- An item without one\n- [x] Another checked item, this one with **emphasis** and `code`',
  },
  {
    id: 'FOOTNOTES_DOC',
    configIndex: 4,
    doc: "# Footnotes\n\nThe renderer collects every definition into a single footer section and\nrenumbers the markers[^1] in reference order. Labels can be numbers or\nwords[^setup], and a definition can run to several paragraphs[^long].\n\nA reference may also appear inside other inline formatting, such as\n**bold text[^nested]** or a list item:\n\n- The first item cites a source[^1].\n- The second one does not.\n\n[^1]: A short, single-paragraph definition.\n\n[^setup]: Referenced second, so it renders as footnote 2 regardless of\n    where its definition sits in the source.\n\n[^long]: The first paragraph of a longer note.\n\n    A second paragraph, indented four spaces to stay inside the note.\n\n    ```ts\n    import { defaultEnginePlugins } from '@ai-react-markdown/core/plugins';\n    ```\n\n[^nested]: Definitions are matched by label, so nesting the reference\n    inside emphasis changes nothing.",
  },
  {
    id: 'DEFINITION_LIST_DOC',
    configIndex: 5,
    doc: '# Glossary\n\nDesign token\n: A named CSS custom property such as `--aim-color-anchor`.\n: The smallest unit a consumer can override without touching a stylesheet.\n\nEngine plugin\n: One selectable entry in the parse chain. The set is sealed — plugins are\n  values exported by the library, not functions a consumer writes.\n\nPrefix freeze\n: The incremental parsing strategy. Everything before the frozen boundary is\n  reused verbatim across a streaming append; only the tail is reparsed.\n\nA term may carry inline formatting, and so may its definitions:\n\n**Clobber prefix**\n: The per-document namespace prepended to generated ids so that two\n  documents on one page cannot collide.',
  },
  {
    id: 'MATH_DOC',
    configIndex: 0,
    doc: '# Math\n\nInline formulas sit in the run of text: the mass–energy equivalence $E = mc^2$\nand the golden ratio $\\varphi = \\frac{1 + \\sqrt{5}}{2}$ both flow with the\nsurrounding prose.\n\n## Display math\n\nA `$$` block is centered on its own line:\n\n$$\n\\int_{0}^{1} x^2 \\, dx = \\frac{1}{3}\n$$\n\n## Aligned equations\n\n$$\n\\begin{aligned}\nf(x) &= (x + 1)^2 \\\\\n     &= x^2 + 2x + 1\n\\end{aligned}\n$$\n\n## Matrices\n\n$$\nA = \\begin{pmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{pmatrix}\n\\qquad\n\\det A = -2\n$$\n\nSums and limits keep their full size in display mode:\n\n$$\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}\n$$',
  },
  {
    id: 'CJK_MIXED_DOC',
    configIndex: 1,
    doc: '# 国际化文本\n\n## 中文\n\n这个组件用React18写的，构建工具是Vite，包管理器用pnpm。\n**「强调」**紧跟全角标点时，星号依然要渲染成加粗。\n\n## 日本語\n\nこのライブラリはTypeScriptで書かれており、Reactのバージョンは18です。\n**「強調」**の直後に句読点が来ても、アスタリスクは記号として扱われます。\n\n## 한국어\n\n이 라이브러리는TypeScript로 작성되었고React18에서 동작합니다.\n**「강조」**뒤에 문장 부호가 와도 별표는 그대로 표시되지 않습니다.\n\n## 表格\n\n| 属性 | 类型 | 说明 |\n| :--- | :--- | :--- |\n| `content` | `string` | 要渲染的markdown文本 |\n| `streaming` | `boolean` | 是否处于流式输出中 |\n| `fontSize` | `string` | 根字号，其余尺寸按比例缩放 |',
  },
  {
    id: 'RTL_DOC',
    configIndex: 2,
    doc: '# النص العربي\n\nهذه فقرة قصيرة باللغة العربية تعرض كيفية عرض النص من اليمين إلى اليسار.\nالمتصفح يحدد اتجاه النص من الأحرف نفسها.\n\n- العنصر الأول\n- العنصر الثاني\n- عنصر يحتوي على كلمة إنجليزية مثل `streaming` داخل النص\n\n> اقتباس قصير يوضح أن التنسيق يعمل أيضًا مع النص العربي.',
  },
  {
    id: 'MARK_HIGHLIGHT_DOC',
    configIndex: 3,
    doc: '# Highlighted text\n\nA run wrapped in double equals signs becomes ==a mark element==, which the\ndefault stylesheet paints with `--aim-color-mark-bg`.\n\n- A ==highlighted phrase== inside a list item\n- Highlighting composes with **bold**, so ==**both at once**== works\n- It stops at the closing delimiter: ==this is marked== and this is not\n\n> A blockquote can carry ==a highlight== too.\n\nInside a code span the syntax is inert: `==not marked==`.',
  },
  {
    id: 'SMARTYPANTS_DOC',
    configIndex: 4,
    doc: '# Typographic punctuation\n\nShe said "the renderer handles this" and then added \'or it should\'.\n\nA pause -- the kind that wants a dash -- and a trailing thought...\n\nA run of three hyphens --- inside a sentence is left exactly as typed.\n\n- "Quoted list item"\n- An item with an apostrophe: the parser\'s job\n- A range written with a dash: pages 10 -- 20\n\nInside code the characters are left exactly as typed: `"quoted" -- and...`,\nand the same holds for fenced blocks:\n\n```text\nprintf("literal -- quotes and dots... survive\\n");\n```',
  },
  {
    id: 'COMMENTS_DOC',
    configIndex: 5,
    doc: '# Draft notes\n\n<!-- Reviewer: tighten the opening paragraph before publishing. -->\n\nThe visible document opens here. Nothing in this paragraph came from a\ncomment, and nothing a comment says should ever appear on the page.\n\nA comment can also sit inline <!-- like this one --> in the middle of a\nsentence without breaking the run of text around it.\n\n<!--\nA multi-line comment.\nIt holds several lines of notes that are not part of the document.\n-->\n\n## Second section\n\nComments inside a fenced block are content, not comments, and stay visible:\n\n```html\n<!-- this one is source code, so it renders -->\n```',
  },
  {
    id: 'URL_SCHEMES_DOC',
    configIndex: 0,
    doc: '# Link schemes\n\nAllowed by the default schema:\n\n- [An absolute https link](https://example.com/guide)\n- [A relative link](./getting-started.md)\n- [A fragment link](#link-schemes)\n- [A mailto link](mailto:support@example.com)\n\nDropped by the default schema — the text survives, the `href` does not:\n\n- [A javascript: link](javascript:alert(1))\n- [A data: link](data:text/html,hello)\n\nDropped unless the consumer extends the schema:\n\n- [A custom app scheme](app://settings/appearance)\n- [Another custom scheme](myapp:open?id=42)\n\nAutolinks go through the same check: https://example.com/autolinked',
  },
  {
    id: 'LINKED_PROSE_DOC',
    configIndex: 1,
    doc: "# Integration notes\n\nStart from the [package README](https://example.com/readme) and the\n[configuration guide](https://example.com/config). The [changelog](https://example.com/changelog)\nlists what moved in each major version, and questions go to the\n[issue tracker](https://example.com/issues).\n\nInstall it and render a string:\n\n```tsx\nimport AIMarkdown from '@ai-react-markdown/core';\n\nexport const Answer = ({ text }: { text: string }) => <AIMarkdown content={text} />;\n```\n\nReplacing a renderer is one prop. See the [custom components guide](https://example.com/custom-components)\nfor the full element list:\n\n```ts\nconst COMPONENTS = { a: BadgedLink, pre: CopyPre };\n```\n\nContact [support](mailto:support@example.com) if a document renders wrong.",
  },
  {
    id: 'CODE_SAMPLES_DOC',
    configIndex: 2,
    doc: '# Code blocks\n\nA TypeScript fence:\n\n```ts\nimport AIMarkdown from \'@ai-react-markdown/core\';\n\nexport const Answer = ({ text }: { text: string }) => (\n  <AIMarkdown content={text} streaming />\n);\n```\n\nA Python fence:\n\n```python\ndef stream(chunks):\n    buffer = ""\n    for chunk in chunks:\n        buffer += chunk\n        yield buffer\n```\n\nA minified JSON payload, wide enough to need horizontal scrolling:\n\n```json\n{"model":"claude","stream":true,"messages":[{"role":"user","content":"hi"}],"max_tokens":1024,"metadata":{"session":"a1b2c3","retries":0}}\n```\n\nAn info string carrying a filename — the whole string becomes the class name:\n\n```js:src/main.js\nconsole.log(\'hello\');\n```\n\nAn unrecognized language is passed through rather than guessed at:\n\n```wobbledy\nnobody knows what this is\n```\n\nAnd a fence with no info string at all:\n\n```\nplain preformatted text\n```',
  },
  {
    id: 'SECRETS_DOC',
    configIndex: 3,
    doc: "# Deploying the worker\n\nSet the API key to sk-a91f4c7d2be08135 before the first request, or the\nclient falls back to anonymous quota.\n\nYou can also export it inline: `export ANTHROPIC_API_KEY=sk-77b0e14aa9c3d562`.\n\n```bash\ncurl https://api.example.test/v1/messages \\\n  -H 'x-api-key: sk-3f1c99e07ad4b628' \\\n  -H 'content-type: application/json'\n```\n\nRotate the key after the deploy.",
  },
  {
    id: 'KITCHEN_SINK',
    configIndex: 4,
    doc: "# Streaming a model response into React\n\nYou asked how to render tokens as they arrive without the layout jumping around.\nThe short answer: keep one buffer, parse all of it on every frame, and let the\nrenderer work out what actually changed. The long answer is below.\n\n## Why appending markup fails\n\nA response that is still being written is *malformed* almost all of the time — a\nfence that has opened but not closed, a table with a header and no body, a link\nwhose URL stops halfway. Appending pre-rendered HTML bakes each of those\nhalf-states into the DOM permanently.\n\n> Treat every frame as a complete document that simply happens to be short.\n> A parser that expects well-formed input will fight you on every token.\n\n## The render loop\n\n```mermaid\nflowchart LR\n    A[Token arrives] --> B[Append to buffer]\n    B --> C[Parse the whole buffer]\n    C --> D{Prefix unchanged?}\n    D -- yes --> E[Reuse cached blocks]\n    D -- no --> F[Re-render the tail]\n    E --> G[Commit]\n    F --> G\n```\n\n## Wiring it up\n\nThe client owns a single string and hands it down whole. There is no diffing to\nwrite by hand — `streaming` tells the renderer that the tail is provisional:\n\n```tsx\nimport { useEffect, useState } from 'react';\nimport AIMarkdown from '@ai-react-markdown/core';\n\nexport function Answer({ stream }: { stream: AsyncIterable<string> }) {\n  const [text, setText] = useState('');\n  const [streaming, setStreaming] = useState(true);\n\n  useEffect(() => {\n    (async () => {\n      for await (const delta of stream) setText((prev) => prev + delta);\n      setStreaming(false);\n    })();\n  }, [stream]);\n\n  return <AIMarkdown content={text} streaming={streaming} />;\n}\n```\n\nOn the server, relaying an upstream response is the same shape:\n\n```python\nasync def relay(client, messages):\n    async with client.messages.stream(model=MODEL, messages=messages) as stream:\n        async for delta in stream.text_stream:\n            yield delta\n```\n\nWorth checking the transport by hand once, before blaming the renderer:\n\n```bash\ncurl -N https://api.example.test/v1/messages \\\n  -H 'content-type: application/json' \\\n  -d @request.json\n```\n\n## What it costs\n\nMeasured on a 12,000-character answer delivered over roughly 900 frames[^bench]:\n\n| Stage | Median | p95 | Share of frame |\n| :---- | -----: | --: | -------------: |\n| Parse | 0.9 ms | 2.4 ms | 31% |\n| Reconcile | 1.4 ms | 4.1 ms | 48% |\n| Paint | 0.6 ms | 1.8 ms | 21% |\n\nThe cost of a frame tracks the number of blocks that changed, not the length of\nthe document. With $n$ blocks and a per-block render cost $c_i$, the work is\nproportional to the blocks whose content actually moved:\n\n$$\nT(n) = t_{\\text{parse}} + \\sum_{i=1}^{n} c_i \\cdot \\left[ b_i \\neq \\hat{b}_i \\right]\n$$\n\nIn a streamed answer only the last block changes between most frames, so the sum\ncollapses to a single term and the parse dominates.\n\n## Before you ship\n\n- [x] Render from one buffer, never from appended fragments\n- [x] Keep the parse a pure function of the buffer\n- [ ] Decide what a footnote does before its citation arrives\n  - [x] Pick a policy\n  - [ ] Write it down for the next reader\n- [ ] Show something when the stream stalls\n\n## Beyond Latin text\n\nAnswers are not always English. Emphasis markers that sit flush against\nfull-width punctuation, spacing between CJK and Latin words, right-to-left\nparagraphs — each has its own failure mode, and each has a dedicated story\nunder *Features → CJK & International Text* showing how the renderer handles\nit.\n\n![Streaming document icon](./vue-markdown-icon.svg \"Streaming document icon\")\n\nThat icon is served from the local assets directory — this document makes no\nexternal requests.\n\n[^bench]: Numbers come from the Performance Lab harnesses in this Storybook,\n    running a development build of React. Treat the ratios as meaningful and the\n    absolute values as inflated.",
  },
  {
    id: 'REF_RESOLUTION_LINK',
    configIndex: 0,
    doc: 'cites [a] here and [b][] twice\n\n[a]: /url-a\n[b]: /url-b\n\nprose after the defs\n\nmore prose\n\nend\n',
  },
  {
    id: 'REF_RESOLUTION_FOOTNOTE',
    configIndex: 1,
    doc: 'a note[^n] and another[^m]\n\n[^n]: first note body\n\n[^m]: second note body\n\nafter the notes\n\nend\n',
  },
  {
    id: 'REF_RESOLUTION_TITLED',
    configIndex: 2,
    doc: '[spec][] with [x] inline\n\n[spec]: /s "The Title"\n[x]: /x\n\nclosing paragraph\n\ntail prose\n\nend\n',
  },
  {
    id: 'TAB_INDENT_DOC',
    configIndex: 3,
    doc: '# Tabs in structure\n\n-\ttab after the marker\n-\tsecond item\n\tcontinuation indented by a tab\n\n1.\tordered\n2.\titems\n\t- nested by a tab\n\t\tdeep continuation\n\n>\tquoted with a tab\n>\t\tcode inside the quote\n\n\tcode indented by one tab\n  \tcode via two spaces and a tab\n\npara line\n\t\npara after a tab-only blank line\n\n#\ttab heading\n\n-\t-\t-\n\nclosing prose\n',
  },
  {
    id: 'TAB_FENCE_TABLE_DOC',
    configIndex: 4,
    doc: '## Fences and tables\n\n```\ncode\n\t```\nstill inside the fence\n```\n\n\t```\nindented code, not an opener\n```\nreal fence\n```\n\n| a\t| b |\n| -\t| - |\n|\t1\t|\t2\t|\n\n[a]:\t/u\t"t"\n\nsee [a] and a claim[^n]\n\n[^n]:\tnote body\n\n\ttab continuation of the note\n\nTerm line\n:\tdescription body\n\nSetext title\n===\t\n\ntrailing prose\n',
  },
  {
    id: 'TAG_PREFIX_BLOCKS_DOC',
    configIndex: 5,
    // The table-part prefixes (`td-cell`, `tr-row`, `col-md-6`,
    // `caption-box`) are deliberately absent here: outside a real table the
    // splice guard's `\b` match refuses every later frame (the over-block
    // recorded in tagNamePrefixAxis.test.ts), and this corpus must keep the
    // oracle sweep's engagement floor. They sit inside real tables in the
    // next doc.
    doc: '# Prefixed names\n\n<prefix>\ninner prose\n</prefix>\n\np <framework>f</framework> q and <images>i</images> inline\n\n<header class="c" data-x="a>b">\nattrs on the tag line\n</header>\n\n<styled>\n<style>.a{}</style>\n</styled>\n\n<scripted>\n<script>x</script>\n</scripted>\n\n<textareas>\n<textarea>t</textarea>\n</textareas>\n\n<header>\n<h1>x</h1>\n</header>\n\n<html-x>\nx\n</html-x>\n\n<body-x>\nx\n</body-x>\n\nclosing prose\n',
  },
  {
    id: 'TAG_PREFIX_TABLE_MIX_DOC',
    configIndex: 0,
    doc: '# Prefixed names next to real tables\n\nintro prose before the first table\n\n<table>\n<tr><td-cell>x</td-cell></tr>\n</table>\n\nprose between the tables\n\n<table>\n<tr-row><td>x</td></tr-row>\n</table>\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n<pre>\n<prefix>x</prefix>\n</pre>\n\n<script>\nlet s = "<scripted>";\n</script>\n\n<images>\n<img src="x">\n</images>\n\np <framework>f</framework> after the blocks\n\nclosing prose\n',
  },
];

/** Pinned fast-check corpus: 1000 benign + 1000 hazard-dense samples. */
export const PINNED_FUZZ_SEED = 20260824;

export function pinnedFuzzDocs(): PinnedDoc[] {
  const out: PinnedDoc[] = [];
  const benign = fc.sample(benignDocArb, { seed: PINNED_FUZZ_SEED, numRuns: 1000 });
  const hazard = fc.sample(hazardDocArb, { seed: PINNED_FUZZ_SEED + 1, numRuns: 1000 });
  benign.forEach((d, i) => out.push({ id: `benign-${i}`, configIndex: d.configIndex, doc: d.doc }));
  hazard.forEach((d, i) => out.push({ id: `hazard-${i}`, configIndex: d.configIndex, doc: d.doc }));
  return out;
}

/** FNV-1a over ids + docs — drift detector for stored baselines. */
export function corpusFingerprint(docs: readonly PinnedDoc[]): string {
  let h = 0x811c9dc5;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const d of docs) {
    mix(d.id);
    mix(' ');
    mix(d.doc);
    mix(String(d.configIndex));
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
