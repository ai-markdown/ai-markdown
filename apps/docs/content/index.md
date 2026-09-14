# Introduction

AI Markdown renders Markdown in React and Vue, including AI responses that arrive a little at a time. It supports GFM, math and mixed-language text, with controls for streaming, custom components and shared references.

Start by rendering one message. Add smooth output, custom styling or document coordination when your application needs them.

## Choose your framework

| Your application     | Start here                                                 | Included setup                                 |
| -------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| React 19             | [React quick start](guides/react-quick-start.md)           | Installation, CSS and a working component      |
| Vue 3.5              | [Vue quick start](guides/vue-quick-start.md)               | Installation, CSS and a working Vue component  |
| React with Mantine 9 | [Mantine quick start](guides/react-mantine-quick-start.md) | Theme providers, highlighted code and diagrams |

Not sure which package to install? Start with [installation and framework selection](guides/getting-started.md). Want to try it first? [Open the interactive examples](examples:).

## Build a streaming experience

For a chat response, append incoming text to one string and pass the complete current string to one renderer. The application handles the network connection; AI Markdown handles the rendered content.

1. **Receive text:** understand [input, completion and cancellation](guides/streaming-input.md).
2. **Render a response:** follow the [React chat recipe](guides/streaming-chat-example.md) or [Vue streaming guide](guides/vue-streaming.md).
3. **Control the pace:** add [React smooth streaming](guides/smooth-streaming.md) or the [Vue smooth component](guides/vue-streaming.md).

[Document coordination](guides/documents-and-references.md) is for one logical document deliberately displayed in multiple sections. A normal chat message does not need it; network packets are not separate Markdown components.

<span id="customize-rendering"></span>
<span id="customize-your-renderer"></span>

## Make it fit your application

| You want to…                  | Read next                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change rendered elements      | [React custom components](guides/custom-components.md) or [Vue components and styles](guides/vue-customization.md)                                              |
| Adjust typography             | [React typography](guides/custom-typography.md), [Vue styles](guides/vue-customization.md) or [Mantine configuration](reference/react-mantine.md#configuration) |
| Handle mixed-language content | [CJK typography](guides/cjk-typography.md)                                                                                                                      |
| Control links and raw HTML    | [URL and HTML policies](guides/url-sanitization.md)                                                                                                             |
| Use server rendering          | [React SSR](guides/react-ssr.md) or [Vue SSR](guides/vue-ssr.md)                                                                                                |

The base adapters render code fences as code text. Syntax highlighting and Mermaid rendering require the Mantine integration or custom components.

<span id="build-an-adapter"></span>
<span id="go-deeper"></span>

## Find the right level of detail

Start with [configuration](guides/configuration.md) to choose the right setting. Use [Find a guide](guides/index.md) for a task, or the [React](reference/react.md), [Vue](reference/vue.md) and [Mantine](reference/react-mantine.md) references for an exact API. If something does not work, start with [troubleshooting](guides/troubleshooting.md).

Adapter authors can continue to [Core and Engine contracts](guides/api/core-engine-contracts.md). Development commands, architecture and release archives live under **Contributing**; they are not prerequisites for using the library.
