# Code blocks, diagrams, images and tables

These component entries are currently available in repository builds and are scheduled for the next package release. The published 3.2.2 packages do not include them.

The optional components register directly on Markdown. No AST wrapper or additional provider is needed. React uses `customComponents`; Vue uses `components`. Base Markdown rendering remains available without these imports.

## React

Install `mermaid@^11.17.2` to use the default code component, then register the three HTML element renderers:

```tsx
import AIMarkdown from '@ai-markdown/react';
import { MarkdownCodeBlock, MarkdownImage, MarkdownTable } from '@ai-markdown/react/components';
import '@ai-markdown/react/components/styles.css'; // optional neutral skin

const components = { pre: MarkdownCodeBlock, img: MarkdownImage, table: MarkdownTable };

<AIMarkdown content={content} streaming={streaming} customComponents={components} />;
```

Mermaid is a built-in **code language renderer**, selected by an explicit `mermaid` fence. It loads on the client; the server and initial hydration show source code. Copy always uses the latest raw source, including during streaming, regardless of the displayed preview or formatted code.

## Vue

```vue
<script setup lang="ts">
import { AIMarkdown } from '@ai-markdown/vue';
import { MarkdownCodeBlock, MarkdownImage, MarkdownTable } from '@ai-markdown/vue/components';
import '@ai-markdown/vue/components/styles.css';

const components = { pre: MarkdownCodeBlock, img: MarkdownImage, table: MarkdownTable };
</script>

<template>
  <AIMarkdown :content="content" :streaming="streaming" :components="components" />
</template>
```

The components are ordinary synchronous Vue components. Markdown provides `node`, `streaming` and `metadata` as declared props, element attributes as attrs, and already-rendered children as a default slot. No slot adapter is necessary.

## Extend a code language

Create the component once outside render/setup's reactive effects. Factory options belong to that returned component, so one Markdown instance cannot overwrite another's renderer map.

```tsx
import { createMarkdownCodeBlock, type CodeRendererInput } from '@ai-markdown/react/components/code';

function StatusPreview({ code, active }: CodeRendererInput) {
  return <output hidden={!active}>{code}</output>;
}
const AppCode = createMarkdownCodeBlock({
  renderers: { status: StatusPreview, mermaid: false },
  formatJson: true,
  expandNestedJson: false,
});
// customComponents={{ pre: AppCode }}
```

Vue exposes the same factory from `@ai-markdown/vue/components/code`; renderer values are Vue components declaring the input props. Renderer keys are trimmed and lowercased. Custom entries replace built-ins, `false` disables one, and unknown languages display ordinary code. Automatic language detection only informs highlighting and formatting; it never selects a specialized renderer.

A renderer receives `code`, `language`, document-level `streaming`, `colorScheme`, `active`, and an opaque `resetKey`. Source append preserves its instance; replacement changes the generation. Stop or invalidate asynchronous work when `active` becomes false, `resetKey` changes, or the component unmounts. Rendering errors fall back to source, but arbitrary promises started by custom renderers must handle their own errors. If two business documents have identical input, use a different Markdown key to force a new lifecycle. React also observes its document context; Vue applications should key Markdown by their document identity when replacing it.

Default neutral options are `defaultExpanded: true`, `autoDetectUnknownLanguage: true`, `highlightIntervalMs: 50`, `mermaidIntervalMs: 300`, `formatJson: false`, and `expandNestedJson: false`. React factory values override the existing `codeBlock` behavior group, which overrides these defaults. Group transport still replaces whole groups. Vue accepts options through the factory; its `colorScheme` option accepts `'light'`, `'dark'`, or a reactive getter. Changing CSS colors alone does not change Mermaid's theme.

Syntax highlighting is optional. The `highlight(code, language)` factory option returns React nodes or Vue VNodes. Without it, code remains plain selectable text. For a trusted highlight.js instance in React:

```tsx
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.css';

const HighlightedCode = createMarkdownCodeBlock({
  highlight(code, language) {
    if (!hljs.getLanguage(language)) return code;
    const html = hljs.highlight(code, { language }).value;
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  },
});
```

In Vue, return `h('span', { innerHTML: html })` from the corresponding callback. Only pass HTML produced by the trusted highlighter, never the raw Markdown source. Drivers that load grammars asynchronously should own their reactive loading state. The existing Mantine highlighter provider remains supported without a replacement provider.

## Imports without Mermaid

`mermaid: false` is a runtime option. Bundlers can still resolve the default code entry's dynamic Mermaid import, so install the optional peer when importing that entry. For an application with no Mermaid dependency, use the plain entry:

```ts
import { MarkdownCodeBlock, createMarkdownCodeBlock } from '@ai-markdown/react/components/code/plain';
import { MarkdownImage } from '@ai-markdown/react/components/image';
import { MarkdownTable } from '@ai-markdown/react/components/table';
```

The same paths exist under `@ai-markdown/vue`. Plain code supports custom renderers but has no built-in diagram driver. Image/table entries have no Mermaid imports. `preloadCodeAssets()` from the default code entry can warm the engine; handle its rejected promise if loading fails.

## Image preview

Server-rendered images remain visible before JavaScript loads. After hydration, loading/error feedback is enabled and a ready ordinary image becomes a keyboard-operable preview trigger. Enter opens a fullscreen preview; Escape or Close dismisses it and restores focus. The dialog is portalled to the document body so inline images never create invalid paragraph markup. The preview follows [rc-image](https://github.com/react-component/image): a dark fullscreen mask, side navigation, and a floating toolbar with vertical/horizontal flip, left/right rotation and zoom. Zoom ranges from 1× to 50× in 1.5× steps; wheel and double-click zoom around the pointer, dragging rebounds at viewport edges, and touch supports panning and pinch zoom. Switching images resets the transform. Loading/error feedback, focus trapping and scroll locking are preserved. React and Mantine use `@rc-component/image`; Vue implements the same interaction rules with a native dialog. Images inside links/buttons or matching interactive roles keep their original behavior, including dynamically changed roles.

The preview uses the browser's selected `currentSrc` (or sanitized `src`), preserving responsive images. Changing `src`/`srcSet` closes the preview. Attributes and image events stay on the actual image. There is no separate high-resolution URL resolver or second URL-policy pass.

### Image icons and galleries

The thumbnail shows a placeholder while loading and an error surface if loading fails. Its `alt` text remains available. Ready images show a preview icon on hover or keyboard focus: Lucide `image-play` for one image and `gallery-thumbnails` for a gallery. Loading and error states use `image` and `image-off` respectively.

Configure semantic icons once, then register the returned component directly:

```tsx
import { createMarkdownImage } from '@ai-markdown/react/components/image';

const AppImage = createMarkdownImage({
  icons: {
    placeholder: <span>Loading</span>, // React node
    error: AssetUnavailableIcon, // React component
    preview: ViewPhotoIcon,
    gallery: OpenAlbumIcon,
  },
});
// customComponents={{ img: AppImage }}
```

Vue exposes `createMarkdownImage` from `@ai-markdown/vue/components/image`. The same keys accept Vue components or VNodes such as `h(AssetUnavailableIcon)`. Mantine exports its factory from `@ai-markdown/react-mantine/components`, using the same rc-image preview as React. Omitted keys retain their defaults; `null` hides an icon. Icons are decorative; preview buttons retain their accessible labels. Custom icons should not contain interactive controls.

Toolbar icons are configurable through the same `icons` option: `close`, `prev`, `next`, `flipX`, `flipY`, `rotateLeft`, `rotateRight`, `zoomIn`, and `zoomOut`.

By default, loaded previewable images within the nearest Markdown typography root form a gallery in DOM order. Linked images, failed images and pending images are excluded. The dialog provides Previous/Next buttons and left/right arrow keys, and closes if its selected image disappears. Escape restores focus to the image that opened the gallery. Separate Markdown roots stay isolated.

Use `group: false` for independent previews, or `group: '[data-photo-album]'` to choose a business-owned ancestor as the group boundary. A custom typography root can carry `data-aimd-image-scope` to opt into automatic grouping. Without a matching root, the image previews independently. `preview: false` retains loading/error feedback without adding a preview button.

Import the optional component stylesheet to get the supplied fullscreen preview layout, or provide equivalent styles for `.aimd-image-preview-*`.

The optional stylesheet exposes `.aimd-image`, `.aimd-image-cover`, `.aimd-image-feedback` and `.aimd-image-icon`. After hydration, thumbnail state is available as `data-status="loading|ready|error"`. Business styles can override these selectors without wrapping the Markdown component.

## Table export

Tables retain their rendered children and custom `th`/`td` components. The wrapper adds keyboard-focusable horizontal scrolling, Copy table (TSV), and Download CSV (UTF-8 with BOM). Export takes a synchronous snapshot of the currently committed sanitized table, so an ongoing stream does not mutate an export already started.

Exported values follow Markdown semantics: link labels, inline code text, image alt text, line breaks, and TeX math annotations once. Extra buttons or UI inserted by a custom cell renderer are excluded. Text may already reflect configured typography transformations. Formula-like text is prefixed with an apostrophe for spreadsheet import; negative numbers remain numeric. Escaping embedded quotes, delimiters and newlines is separate from that text policy.

Only rectangular tables without merged cells are exported. Unsupported structures remain visible and scrollable, with export disabled and a reason. This component does not sort, edit, paginate or virtualize data.

## Mantine and styling

`@ai-markdown/react-mantine/components` exports the same three registration components and its `createMarkdownCodeBlock` / `createMarkdownImage` factories. Its ordinary code and built-in Mermaid retain Mantine's existing highlighter provider, JSON defaults and diagram interactions. Explicit language extensions use the neutral source/copy shell. The image preview uses the same rc-image engine and skin as React; the table uses the shared React component; import `@ai-markdown/react/components/styles.css` for their neutral skin alongside the usual Mantine styles.

The neutral CSS is optional and scoped to `aimd-*` classes. Code, table and image feedback surfaces expose `--aimd-border`, `--aimd-surface`, and `--aimd-text`. React components follow the Markdown theme, including the resolved Mantine theme. Vue code follows its factory option; Vue tables and image feedback inherit a `[data-color-scheme="dark"]` or `[data-mantine-color-scheme="dark"]` ancestor. HTML controls remain usable without this CSS. Override the classes and variables in application styles rather than wrapping the components solely to restyle them.

A `pre` override owns ordinary fenced code. A separate `code` override still applies to inline code and fallback `pre` structures, but is not automatically composed into the enhanced block. Nonstandard `pre` structures or additional node attributes keep the original rendering intact.
