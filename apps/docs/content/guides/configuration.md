# Configure rendering

Start with a working [React](react-quick-start.md), [Vue](vue-quick-start.md) or [Mantine](react-mantine-quick-start.md) setup. Then choose the layer you need to change. React and Vue share parsing options, but their component and styling APIs differ.

## Choose what to change

| Goal                                         | Configuration                                                         | Guide                                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Show incoming text                           | Update the accumulated `content`; set `streaming` from producer state | [Streaming input](streaming-input.md)                                                                                |
| Smooth bursty updates                        | Use the framework's smooth component or hook/composable               | [React](smooth-streaming.md) · [Vue](vue-streaming.md)                                                               |
| Select optional syntax transforms            | `enginePlugins`                                                       | [Markdown features](markdown-features.md#selectable-engine-plugins)                                                  |
| Clean up source text before parsing          | `contentPreprocessors`                                                | [Preprocessors](content-preprocessors.md)                                                                            |
| Replace links, code blocks or other elements | React `customComponents`; Vue `components` or named slots             | [React](custom-components.md) · [Vue](vue-customization.md)                                                          |
| Change fonts, spacing and colors             | React typography/CSS variables; Vue wrapper styles; Mantine theme     | [React](custom-typography.md) · [Vue](vue-customization.md) · [Mantine](../reference/react-mantine.md#configuration) |
| Control allowed HTML and URLs                | `sanitizeSchema` and `urlTransform`                                   | [Links and HTML safety](url-sanitization.md)                                                                         |
| Share references across sections             | `AIMarkdownDocuments` with an explicit document id                    | [Documents and references](documents-and-references.md)                                                              |

## Know what is enabled

GFM, math processing, emoji, source line breaks, CJK-aware delimiter parsing and guarded raw HTML belong to the base pipeline. The five shipped optional plugins are enabled by default. Passing `enginePlugins` replaces that optional set; an empty array does not disable the base pipeline or sanitization.

The `highlight` plugin means `==marked text==`, not code syntax highlighting. Code highlighting and Mermaid require [Mantine](mantine-code-blocks.md) or your own renderer. See the [syntax overview](markdown-features.md) for the full distinction.

## Keep configuration stable

Define plugin arrays, preprocessors and policy objects outside the render function when they are constant. If they depend on application settings, keep their references stable until those settings change. For Vue composables, pass a live getter so later updates remain observable.

The plugin catalog accepts only the shipped objects. Arbitrary remark/rehype plugins are not accepted through `enginePlugins`; use the documented preprocessing and custom-rendering extension points instead.

## Check the scope before overriding

`streaming` describes the producer; it is not the switch for incremental parsing. React's cursor is opt-in, while Vue's is enabled by default. React typography props and hooks do not apply to Vue.

URL transformation runs after sanitization. A custom component must also apply the application's output policy to URLs or HTML it creates. Follow [Links and HTML safety](url-sanitization.md) before changing either stage.

## Look up exact options

Use [React props](api/react-props.md), [Vue component props](../reference/vue.md#component-props) or [Mantine configuration](../reference/react-mantine.md#configuration) for types, defaults and precedence. For an unexpected result, start with [troubleshooting](troubleshooting.md).
