# Find a guide

Choose a task below, or start with [installation](getting-started.md) if this is your first visit. Framework-specific guides are marked React, Vue or Mantine; shared parsing guides apply to all three.

## Choose your adapter

| Application              | First render                                        | Next task                                                                              | Reference                                                                                    |
| ------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| React                    | [React quick start](react-quick-start.md)           | [Streaming chat](streaming-chat-example.md), [custom components](custom-components.md) | [React components](../reference/react.md)                                                    |
| Vue                      | [Vue quick start](vue-quick-start.md)               | [Streaming](vue-streaming.md), [custom rendering](vue-customization.md)                | [Vue API](../reference/vue.md)                                                               |
| React with Mantine       | [Mantine quick start](react-mantine-quick-start.md) | [Code blocks and diagrams](mantine-code-blocks.md)                                     | [Mantine API](../reference/react-mantine.md)                                                 |
| Framework adapter author | [Build a framework adapter](building-an-adapter.md) | [Core and engine contracts](api/core-engine-contracts.md)                              | [Core](../../../../packages/core/README.md), [Engine](../../../../packages/engine/README.md) |

Once the first render works, [Configure rendering](configuration.md) explains which layer to change: parsing options shared by React and Vue, or the component and styling APIs that differ per adapter.

<span id="by-scenario-start-here"></span>

## Streaming

| Task                                                         | Guide                                                         | Applies to |
| ------------------------------------------------------------ | ------------------------------------------------------------- | ---------- |
| Understand accumulated input, completion and cancellation    | [Streaming input](streaming-input.md)                         | All        |
| Build a chat view that renders tokens as they arrive         | [React streaming chat](streaming-chat-example.md)             | React      |
| Smooth out bursty token delivery                             | [React smooth streaming](smooth-streaming.md)                 | React      |
| Show a cursor at the streaming edge                          | [React streaming cursor](streaming-cursor.md)                 | React      |
| Stream into a Vue component                                  | [Vue streaming](vue-streaming.md)                             | Vue        |
| Split a logical document into sections that share references | [Documents and references](documents-and-references.md)       | All        |
| Coordinate footnotes and links across React chunks           | [React documents and references](cross-chunk-coordination.md) | React      |
| Coordinate footnotes and links across Vue chunks             | [Vue documents and references](vue-documents.md)              | Vue        |

## Content and styling

| Task                                               | Guide                                                    | Applies to          |
| -------------------------------------------------- | -------------------------------------------------------- | ------------------- |
| Add code, Mermaid, image preview and table export  | [Rich Markdown components](rich-components.md)           | React, Vue, Mantine |
| Choose which layer to configure                    | [Configure rendering](configuration.md)                  | All                 |
| Check which Markdown syntax renders                | [Markdown features](markdown-features.md)                | All                 |
| Render CJK and mixed-language text                 | [CJK typography](cjk-typography.md)                      | All                 |
| Transform the source before parsing                | [Content preprocessors](content-preprocessors.md)        | All                 |
| Configure URL and HTML policies                    | [URL sanitization](url-sanitization.md)                  | All                 |
| Replace rendered elements with your own components | [React custom components](custom-components.md)          | React               |
| Swap the typography container                      | [React custom typography](custom-typography.md)          | React               |
| Theme spacing, colors and fonts with CSS variables | [React CSS tokens](design-tokens.md)                     | React               |
| Customize rendering and styles in Vue              | [Vue custom rendering and styling](vue-customization.md) | Vue                 |
| Try your own Markdown in the browser               | [Examples and playgrounds](../examples.md)               | All                 |

## Integrations and performance

| Task                                             | Guide                                                           | Applies to |
| ------------------------------------------------ | --------------------------------------------------------------- | ---------- |
| Render code blocks and diagrams with Mantine     | [Mantine code blocks and diagrams](mantine-code-blocks.md)      | Mantine    |
| Server-render and hydrate                        | [React SSR and hydration](react-ssr.md)                         | React      |
| Server-render and manage the component lifecycle | [Vue SSR and lifecycle](vue-ssr.md)                             | Vue        |
| Understand what incremental parsing saves        | [Rendering and performance](rendering-and-performance.md)       | All        |
| Keep re-renders cheap while streaming            | [React streaming and performance](streaming-and-performance.md) | React      |

## API reference

| Need                                   | Page                                                |
| -------------------------------------- | --------------------------------------------------- |
| Every React prop with defaults         | [React props reference](api/react-props.md)         |
| Hooks and providers                    | [React hooks and providers](api/react-hooks.md)     |
| Metadata passed to custom components   | [React metadata context](metadata-context.md)       |
| Generic component and prop types       | [React TypeScript generics](typescript-generics.md) |
| Vue props, slots and exports           | [Vue API](../reference/vue.md)                      |
| Mantine props and configuration        | [Mantine API](../reference/react-mantine.md)        |
| What stays stable under minor versions | [API conventions and stability](api-conventions.md) |

## Troubleshooting and upgrades

| Task                                  | Guide                                                   |
| ------------------------------------- | ------------------------------------------------------- |
| Fix a symptom across adapters         | [Troubleshooting](troubleshooting.md)                   |
| Upgrade from the old package scope    | [Package migration](framework-transition.md)            |
| Upgrade a 1.x installation to 2.0     | [Migrating from 1.x to 2.0](migrating-to-v2.md)         |
| See versioned changes                 | [Release highlights](release-highlights.md)             |
| Decide what to pin or assert in tests | [Stability policy](api-conventions.md#stability-policy) |

The 1.x-to-2.x migration page and the [July 2026 benchmark](benchmark.md) describe their named versions, not today's installation requirements.

## Build an integration

| Task                               | Guide                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build a framework adapter          | [Build a framework adapter](building-an-adapter.md)                                                                                                                                                                                                     |
| Rely on the shared packages        | [Core and engine contracts](api/core-engine-contracts.md)                                                                                                                                                                                               |
| Ship a React design-system package | [Build a React integration](extending-via-subpackage.md)                                                                                                                                                                                                |
| Read the package APIs              | [Core](../../../../packages/core/README.md), [Engine](../../../../packages/engine/README.md), [highlight plugin](../../../../packages/remark-mark-highlight/README.md), [code language detector](../../../../packages/code-language-detector/README.md) |

<span id="full-topic-index"></span>

## Contributing

| Task                                         | Guide                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Run checks, tests and builds                 | [Development commands](development-commands.md)                                                  |
| Learn which package owns which file          | [Architecture overview](architecture.md)                                                         |
| Edit or deploy this site                     | [Documentation site](documentation-site.md)                                                      |
| Develop the Storybook examples               | [Interactive examples](storybook.md)                                                             |
| Measure a change                             | [Benchmarking](benchmarking.md)                                                                  |
| Validate core contracts and state sequences  | [Core testing](core-testing.md)                                                                  |
| Decide whether a change needs a soak         | [Soak coverage map](soak-coverage.md)                                                            |
| Cut a release                                | [Releasing](releasing.md)                                                                        |
| Keep a guide aligned with the implementation | [Reading the implementation](api-conventions.md#reading-the-implementation-alongside-the-guides) |

<span id="release-maintenance"></span>

Release maintenance: [published-artifact verification](releasing.md#repeatable-published-artifact-verification). The [3.0 release acceptance record](releasing-3.0.md) is an archive of that release.

## Moved sections

The following sections used to live on this page. Their content is unchanged.

<span id="a-note-on-stability"></span>

**A note on stability** is now the [stability policy](api-conventions.md#stability-policy) and the [shared packages](api-conventions.md#shared-packages) section.

<span id="conventions-used-in-this-guide"></span>

**Conventions used in this guide** is now [conventions used in the guides](api-conventions.md#conventions-used-in-the-guides).

<span id="reporting-issues-with-these-docs"></span>

**Reporting issues with these docs** is now [reporting issues with these docs](api-conventions.md#reporting-issues-with-these-docs).

<span id="reading-the-implementation-alongside-the-guides"></span>

**Reading the implementation alongside the guides** is now [reading the implementation alongside the guides](api-conventions.md#reading-the-implementation-alongside-the-guides).
