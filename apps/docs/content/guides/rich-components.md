# Code blocks, diagrams, images and tables

These component entries are available from 3.3.0. The shared helpers in `@ai-markdown/core/components` described under [Build a renderer or an adapter](#build-a-renderer-or-an-adapter) are as of 3.4.0.

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

While the document streams, a diagram source is usually an incomplete prefix, so a parse failure is not reported: the block keeps showing the source, or the last diagram that rendered. Attempts are spaced by `mermaidIntervalMs`. When streaming ends, one more pass renders the final source, and if that fails the block shows mermaid's own error message. If the engine module cannot be downloaded, the component retries three times, 1.5 seconds apart, and then shows "Diagram engine could not load." with a Retry button.

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

A renderer receives `code`, `language`, document-level `streaming`, `colorScheme`, `active`, and an opaque `resetKey`. Source append preserves its instance; replacement changes the generation. Stop or invalidate asynchronous work when `active` becomes false, `resetKey` changes, or the component unmounts. Rendering errors fall back to source, but arbitrary promises started by custom renderers must handle their own errors. The supplied code blocks also start a new generation when the `documentId` changes, so another document at the same position is never taken for an append. If two documents have the same id and identical input, use a different Markdown key to force a new lifecycle.

Default neutral options are `defaultExpanded: true`, `autoDetectUnknownLanguage: true`, `highlightIntervalMs: 50`, `mermaidIntervalMs: 300`, `formatJson: false`, and `expandNestedJson: false`. React factory values override the existing `codeBlock` behavior group, which overrides these defaults. Group transport still replaces whole groups. Vue accepts options through the factory; its `colorScheme` option accepts `'light'`, `'dark'`, or a reactive getter. Changing CSS colors alone does not change Mermaid's theme.

A block with no fence language is detected as it streams. `streaming` describes the document and does not say when one fence has closed, so a block whose text has not changed for 300 ms is judged as complete and labelled, even while the rest of the document is still arriving. A block whose text is replaced starts detection over.

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

Server-rendered images remain visible before JavaScript loads. After hydration, loading/error feedback is enabled and a ready ordinary image becomes a keyboard-operable preview trigger. Enter opens a fullscreen preview; Escape or Close dismisses it and restores focus. The preview is a native modal `<dialog>` attached to the document body, so inline images never create invalid paragraph markup, and the browser supplies focus containment, the top layer and Escape. It has a dark fullscreen mask, side navigation, and a floating toolbar with vertical/horizontal flip, left/right rotation and zoom. Zoom ranges from 1× to 50× in 1.5× steps; the wheel, a trackpad pinch and a double click zoom around the pointer. Mouse, pen and touch are handled alike: one pointer drags, two pinch, and an image moved past the viewport edges rebounds. Switching images resets the transform. The page behind cannot scroll while the preview is open: the root element and the body are both locked, a wheel or a touch that the image does not use is cancelled, and the page keeps its width when its scrollbar disappears. The preview grows out of the thumbnail that was activated, and when it closes it shrinks back into the thumbnail of the image then shown, which after navigating a gallery is another one. Each takes 0.3 s. A thumbnail that is out of view is not aimed at; the preview then scales about the centre. There is no animation when the user prefers reduced motion. React, Vue and Mantine share one implementation: the rules live in `@ai-markdown/core/components` (`createImagePreviewController`) and each framework renders the dialog. The interaction rules are adapted from [rc-image](https://github.com/react-component/image) 1.10.0; no package depends on it. Images inside links/buttons or matching interactive roles keep their original behavior, including dynamically changed roles.

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

Vue exposes `createMarkdownImage` from `@ai-markdown/vue/components/image`. The same keys accept Vue components or VNodes such as `h(AssetUnavailableIcon)`. Mantine exports its factory from `@ai-markdown/react-mantine/components`, with the same preview as React. Omitted keys retain their defaults; `null` hides an icon. Icons are decorative; preview buttons retain their accessible labels. Custom icons should not contain interactive controls.

Toolbar icons are configurable through the same `icons` option: `close`, `prev`, `next`, `flipX`, `flipY`, `rotateLeft`, `rotateRight`, `zoomIn`, and `zoomOut`.

By default, the loaded previewable images of one document form a gallery in DOM order. A standalone Markdown instance is one document; instances that share an explicit `documentId` inside `AIMarkdownDocuments` are one document too, so the sections of a coordinated answer share a gallery. Linked images, failed images and pending images are excluded. The dialog provides Previous/Next buttons and left/right arrow keys, and closes if its selected image disappears. Escape restores focus to the image that opened the gallery. Separate documents stay isolated.

Use `group: false` for independent previews, or `group: '[data-photo-album]'` to group by the nearest ancestor that matches a selector you own; an image with no matching ancestor previews independently. The typography root plays no part in grouping, so a custom `Typography` component needs no marker. `preview: false` retains loading/error feedback without adding a preview button.

`preview` also takes an object that configures the preview:

```tsx
const AppImage = createMarkdownImage({
  preview: {
    scaleStep: 0.5, // one step multiplies or divides the scale by 1 + scaleStep
    minScale: 1,
    maxScale: 50,
    movable: true, // false: no dragging and no pinch
    wheel: true, // false: the wheel and a trackpad pinch do not zoom
    onOpenChange: (open, { current, item }) => track('preview', { open, src: item?.src }),
    afterOpenChange: (open) => {},
    onChange: (current, previous) => {},
    onTransform: ({ transform, action }) => {},
  },
});
```

The values shown are the defaults; every entry is optional. `onOpenChange` runs when the preview starts to open or to close, and `afterOpenChange` when an opening or a closing has run to its end; one that is interrupted, by reopening while it closes or by unmounting the image, reports no end. With `minScale` above 1 or `maxScale` below 1, an image starts at the nearest allowed scale. `onChange` runs when the user moves to another image of the gallery. `onTransform` reports each zoom, rotation, flip, drag and rebound with the action that caused it (`zoomIn`, `zoomOut`, `rotateLeft`, `rotateRight`, `flipX`, `flipY`, `wheel`, `doubleClick`, `move`, `pinch`, `rebound`, `prev`, `next`); a drag or a wheel burst reports once per frame. The Vue and Mantine factories take the same object.

Import the optional component stylesheet to get the supplied fullscreen preview layout, or provide equivalent styles for `.aimd-image-preview-*`.

The optional stylesheet exposes `.aimd-image`, `.aimd-image-cover`, `.aimd-image-feedback` and `.aimd-image-icon`. After hydration, thumbnail state is available as `data-status="loading|ready|error"`. Business styles can override these selectors without wrapping the Markdown component.

## Table export

Tables retain their rendered children and custom `th`/`td` components. The wrapper adds keyboard-focusable horizontal scrolling, Copy table (TSV), and Download CSV (UTF-8 with BOM). Export takes a synchronous snapshot of the currently committed sanitized table, so an ongoing stream does not mutate an export already started.

Exported values follow Markdown semantics: link labels, inline code text, image alt text, line breaks, and TeX math annotations once. Extra buttons or UI inserted by a custom cell renderer are excluded. Text may already reflect configured typography transformations. Formula-like text is prefixed with an apostrophe for spreadsheet import; negative numbers remain numeric. Escaping embedded quotes, delimiters and newlines is separate from that text policy.

Only rectangular tables without merged cells are exported. Unsupported structures remain visible and scrollable, with export disabled and a reason. `projectTable` reports the reason as a code (`mergedCells`, `notRectangular`, `unsupportedStructure`, `unsupportedContent` or `unavailable`); the table's labels hold the sentence for each. This component does not sort, edit, paginate or virtualize data.

## Text and translation

Every piece of text these components show is an option of the component that shows it. The defaults are English. No translations are bundled: pass your own strings, or a function that asks your i18n library.

Each component has its own labels. There is no shared dictionary and no global setting:

| Component        | Factory                   | Option          | Type and defaults                           |
| ---------------- | ------------------------- | --------------- | ------------------------------------------- |
| Code block       | `createMarkdownCodeBlock` | `labels`        | `CodeBlockLabels`, `defaultCodeBlockLabels` |
| Mermaid renderer | `createMarkdownCodeBlock` | `diagramLabels` | `DiagramLabels`, `defaultDiagramLabels`     |
| Image            | `createMarkdownImage`     | `labels`        | `ImageLabels`, `defaultImageLabels`         |
| Table            | `createMarkdownTable`     | `labels`        | `TableLabels`, `defaultTableLabels`         |

The types and defaults are exported from `@ai-markdown/core/components`; the types are also exported next to each factory. `diagramLabels` belongs to the default code entry, which has the Mermaid renderer; the plain entry does not take it. `createMarkdownTable` exists only to carry this option: `MarkdownTable` is `createMarkdownTable()`.

An option is a partial object. Entries you leave out keep their default:

```tsx
import { createMarkdownCodeBlock, createMarkdownImage, createMarkdownTable } from '@ai-markdown/react/components';

const Code = createMarkdownCodeBlock({
  labels: { copy: '复制代码', copied: '已复制', copyFailed: '复制失败', expand: '展开', collapse: '收起' },
  diagramLabels: { waiting: '等待图表…', retry: '重试' },
});
const Image = createMarkdownImage({ labels: { loading: '图片加载中…', open: (alt) => `预览图片：${alt}` } });
const Table = createMarkdownTable({ labels: { copy: '复制表格', download: '下载 CSV' } });
```

Most entries are strings. Two take arguments and are functions: `ImageLabels.open(alt)`, and `tooLarge(length, limit)` in the diagram labels.

To follow a language that changes at run time, pass a function that returns the partial object. It is called during every render of the component.

- In React it is called at a fixed place in the render, so it may call hooks. Read your i18n context in it and the component re-renders when the language changes, including blocks that the Markdown memo would otherwise leave alone:

  ```tsx
  function useCodeLabels() {
    const { t } = useTranslation();
    return { copy: t('markdown.copy'), copied: t('markdown.copied') };
  }
  const Code = createMarkdownCodeBlock({ labels: useCodeLabels });
  ```

- In Vue it is called inside the render function, so any reactive state it reads becomes a dependency:

  ```ts
  const Code = createMarkdownCodeBlock({ labels: () => ({ copy: t('markdown.copy'), copied: t('markdown.copied') }) });
  ```

Two texts come from elsewhere and are not labels. A Mermaid parse error is mermaid's own message, which names the failing line and is shown as written. The language name in a code block's toolbar is the fence language or the detected one; only the `plainText` fallback is a label.

## Mantine and styling

`@ai-markdown/react-mantine/components` exports the same three registration components and its `createMarkdownCodeBlock` / `createMarkdownImage` / `createMarkdownTable` factories. Its code block and Mermaid block have their own labels, `labels` and `mermaidLabels` in the `codeBlock` options; see [Mantine code blocks](mantine-code-blocks.md#text-and-translation). Its ordinary code and built-in Mermaid retain Mantine's existing highlighter provider, JSON defaults and diagram interactions. Explicit language extensions use the neutral source/copy shell. The image and its preview are the React ones; the table uses the shared React component; import `@ai-markdown/react/components/styles.css` for their neutral skin alongside the usual Mantine styles.

The neutral CSS is optional and scoped to `aimd-*` classes. Code, table and image feedback surfaces expose `--aimd-border`, `--aimd-surface`, and `--aimd-text`. React components follow the Markdown theme, including the resolved Mantine theme. Vue code follows its factory option; Vue tables and image feedback inherit a `[data-color-scheme="dark"]` or `[data-mantine-color-scheme="dark"]` ancestor. HTML controls remain usable without this CSS. Override the classes and variables in application styles rather than wrapping the components solely to restyle them.

A `pre` override owns ordinary fenced code. A separate `code` override still applies to inline code and fallback `pre` structures, but is not automatically composed into the enhanced block. Nonstandard `pre` structures or additional node attributes keep the original rendering intact.

## Build a renderer or an adapter

`@ai-markdown/core/components` holds the logic the React, Vue and Mantine components share. It has no framework or DOM types. Use it to write a custom language renderer, to replace one of the supplied components, or to write the components for another framework. `@ai-markdown/core` depends on `@ai-markdown/code-language-detector` for the language helper.

| Task                             | Exports                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------- |
| Read a `pre` node                | `extractCode`, `normalizeRenderers`                                             |
| Tell an append from a rewrite    | `extendsCode`                                                                   |
| Build a code block               | `createCodeBlockSession`                                                        |
| Throttle displayed code          | `nextCodeFrame`, `createCodeFrame`                                              |
| Detect an unlabelled language    | `createCodeLanguageTracker`                                                     |
| Format JSON                      | `createJsonCompletenessScanner`, `jsonLooksComplete`, `prettyPrintJson`         |
| Render a Mermaid diagram         | `createDiagramController`                                                       |
| Call Mermaid next to our diagram | `mermaidRenderQueue`, `ensureMermaidInitialized`, `getMermaidMaxTextSize`       |
| Export a table                   | `projectTable`, `serializeTable`                                                |
| Group images                     | `getImageGallery`                                                               |
| Preview an image                 | `createImagePreviewController`, `imageTransformStyle`, `lockImagePreviewScroll` |

### Append or rewrite

The `code` a renderer receives is the hast text of the block, which always ends with one newline that the Markdown source does not have. A chunk that lands in the middle of a line therefore turns `ab\n` into `abc\n`, and a plain prefix test reports a rewrite on almost every chunk. `extendsCode` compares without that newline:

```ts
import { extendsCode } from '@ai-markdown/core/components';

extendsCode('abc\n', 'ab\n'); // true: appended
'abc\n'.startsWith('ab\n'); // false
extendsCode('ax\n', 'ab\n'); // false: rewritten
```

Use it whenever a renderer keeps work between updates, such as an incremental parser or a timer. The supplied code block already uses it to decide `resetKey`, so a renderer that only needs to know when to start over can watch `resetKey`.

### A code block of your own

`createCodeBlockSession` is what the supplied code blocks are built on. One session per block turns the block's source into what to show: the text for the highlighter, the language, and a generation that changes when the block is rewritten.

```ts
import { createCodeBlockSession } from '@ai-markdown/core/components';

const session = createCodeBlockSession(() => rerender());

// During render, server rendering included:
const input = {
  code, // from extractCode(node)
  language, // the fence language, '' when there is none
  streaming,
  autoDetect: true,
  formatJson: false,
  expandNestedJson: false,
  highlightIntervalMs: 50,
};
const { text, language: shownLanguage, generation } = session.read(input);

// Once that render is on screen:
session.commit(input);

// On unmount:
session.dispose();
```

- `text` is the current source, with two exceptions. While the document streams, appends inside `highlightIntervalMs` share one frame, so `text` can be an earlier prefix; a rewrite, a language change and the end of the stream show the current source at once. A JSON block is pretty-printed when `formatJson` is set and the block is complete.
- `language` is the fence language, or the detected one when the fence has none and `autoDetect` is set. A short block is labelled once its text has been still for 300 ms.
- `generation` grows by one when the source is rewritten, when the fence language changes, or when the optional `identity` field changes. An append keeps it. Reset per-block state such as a "copied" message when it changes.
- `read` gives an equal answer for equal input and does not record anything, so a render that is thrown away has no effect. `commit` records the source, lets the language detector look at it and starts the timers; the callback passed to `createCodeBlockSession` runs when a commit or a timer changes the answer. A host that never commits always reads the current source.
- Copy the raw `code`, not `text`.

React applications can call `useCodeBlock(input)` from `@ai-markdown/react/components/code/plain`, which returns the same three fields and does the commit and the cleanup. The parts the session is made of are exported too, for a host that needs only one of them: `nextCodeFrame` and `createCodeFrame` (the display throttle), `createCodeLanguageTracker` (detection and the settle timer), and `createJsonCompletenessScanner` with `prettyPrintJson`.

### A diagram renderer

`createDiagramController` is the render policy described under [React](#react): no error while streaming, one corrective pass at the end, bounded download retries, and no repeated render for unchanged input. The host passes every change of its inputs to `update` and draws the state it receives.

```ts
import { createDiagramController, defaultDiagramLabels, diagramErrorText } from '@ai-markdown/core/components';

const controller = createDiagramController(
  () => import('mermaid').then((module) => module.default),
  ({ view, loadFailed }) => {
    if (view.kind === 'diagram') {
      host.innerHTML = view.svg;
      view.bind?.(host);
    } else if (view.kind === 'error') {
      showError(diagramErrorText(view, defaultDiagramLabels)); // plain text
    } else {
      showSource(); // nothing has rendered yet
    }
    showRetry(loadFailed || view.kind === 'error');
  }
);

controller.update({ code, dark, streaming, active, interval: 300 });
controller.retry(); // from a Retry button
controller.dispose(); // on unmount
```

`view.svg` is mermaid's output under the `strict` or `sandbox` security level and is meant to be inserted as HTML. An error view carries a `reason` and no sentence of the library's own: `tooLarge` has the `length` and the `limit`, while `parse` and `render` have mermaid's `message`, which can be empty. `diagramErrorText(view, labels)` turns it into text with your labels; insert the result as a text node. `active: false` pauses attempts while the host shows something else. `loadFailed` is true once the download retries are spent, and `retry()` starts over with a new budget.

### An image preview

`createImagePreviewController` is the preview without a framework or a DOM: which image of a gallery is shown, how it is transformed, and where it is in opening and closing. The host forwards its events as numbers and draws the state it receives.

```ts
import {
  createImagePreviewController,
  getImageGallery,
  imageTransformStyle,
  lockImagePreviewScroll,
} from '@ai-markdown/core/components';

const controller = createImagePreviewController(
  {
    // Layout box of the previewed image before its transform, and the viewport.
    geometry: () => ({
      width: img.width,
      height: img.height,
      left: img.offsetLeft,
      top: img.offsetTop,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
    }),
    frame: (callback) => {
      const id = requestAnimationFrame(callback);
      return () => cancelAnimationFrame(id);
    },
  },
  (state) => draw(state),
  { closeDuration: () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300) }
);

controller.open(getImageGallery(scope), thumbnail); // the id the thumbnail registered with
img.addEventListener('pointerdown', (event) => {
  if (controller.pointerDown({ id: event.pointerId, x: event.clientX, y: event.clientY, button: event.button })) {
    event.preventDefault();
    img.setPointerCapture(event.pointerId);
  }
});
img.addEventListener('pointermove', (event) =>
  controller.pointerMove({ id: event.pointerId, x: event.clientX, y: event.clientY })
);
img.addEventListener('pointerup', (event) => controller.pointerUp(event.pointerId));
```

- `state.phase` is `closed`, `opening`, `open` or `closing`. Render while it is not `closed`; `opening` and `closing` are the states to style a transition from and to. `closeDuration` is how long `closing` lasts. An optional `anchor(id)` on the host returns the centre of an image's thumbnail as a viewport point; the controller asks for it when the preview opens and again when it closes, and publishes it as `state.origin`, for a `transform-origin` on the element that scales.
- `state.items`, `state.current` and `state.item` follow the gallery while the preview is open. The preview closes when the image shown leaves the gallery.
- `state.transform` goes through `imageTransformStyle`; `state.moving` is true during a drag or a pinch, when the image should follow without a transition; `state.status` is the load state you report with `loaded()` and `failed()`.
- `pointerDown`, `wheel` and `key` return true when they used the event: prevent its default action then. Listen to the wheel with `{ passive: false }`.
- `action(name)` runs a toolbar action; `canPrevious`, `canNext`, `canZoomIn` and `canZoomOut` say which buttons to disable.
- `lockImagePreviewScroll(document.body, window.innerWidth - document.documentElement.clientWidth)` stops the body from scrolling and pads it by the scrollbar it loses. Lock `document.documentElement` too, without a width, since either can be the page's scroller. Call the functions they return when the preview has closed.
- The third argument of `createImagePreviewController` also takes `scaleStep`, `minScale`, `maxScale`, `movable`, `wheel` and the `onOpenChange`, `afterOpenChange`, `onChange` and `onTransform` callbacks described under [image icons and galleries](#image-icons-and-galleries).

The supplied React and Vue previews are this controller in a native modal `<dialog>`. `zoomImage`, `reboundImage`, `imagePinchCenter` and `imageWheelRatio` are the calculations it applies, exported for a host that needs one of them alone.

### Calling Mermaid yourself

Mermaid keeps one global configuration and one global renderer. If the page renders Mermaid outside these components, run that work through the same queue, or its `initialize` can change the theme between our initialization and our render:

```ts
import mermaid from 'mermaid';
import { ensureMermaidInitialized, getMermaidMaxTextSize, mermaidRenderQueue } from '@ai-markdown/core/components';

const owner = {}; // one per diagram instance
await mermaidRenderQueue.enqueue(owner, async () => {
  ensureMermaidInitialized(mermaid, dark);
  if (code.length > getMermaidMaxTextSize(mermaid)) throw new Error('Diagram source is too large.');
  const { svg } = await mermaid.render(id, code);
  draw(svg);
});
// On unmount:
mermaidRenderQueue.cancel(owner);
```

- The queue runs one task at a time and keeps at most one pending task per owner. Enqueueing again for the same owner replaces the pending task; the replaced call resolves without running.
- `ensureMermaidInitialized` keeps the configuration the application passed to `mermaid.initialize`, raises `loose`, `antiscript` or an unset `securityLevel` to `strict`, leaves `sandbox` alone, and follows the color scheme only when the application has not chosen a theme. It does nothing when no key needs to change.
- `getMermaidMaxTextSize` returns the effective `maxTextSize`. Check it before rendering: above the limit `mermaid.render` resolves with a placeholder diagram and does not reject.
- The queue belongs to one copy of `@ai-markdown/core`. It serializes work only when the bundler resolves the components and the application to the same copy.
