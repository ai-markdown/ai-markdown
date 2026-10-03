# Documents and references

Use one renderer for one message unless your layout needs independently mounted sections. Document coordination lets those sections share links, images and footnotes. It does not concatenate their Markdown before parsing.

## Choose the boundary deliberately

| Input                                                    | Recommended rendering                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A message arriving in network packets                    | Accumulate one string and update one renderer                                  |
| Separate chat messages with unrelated citations          | Independent renderers with independent document identities                     |
| One answer displayed as independently parseable sections | Multiple renderers inside a document provider, sharing an explicit document ID |
| Server-only output requiring all references resolved     | One renderer receiving the complete logical document                           |

A fence, table row, emphasis span or formula split across renderer boundaries is still split syntax. The registry can supply a definition from another section; it cannot repair such boundaries.

## Identity, order and isolation

Both adapters export their own `AIMarkdownDocuments`. Put coordinated renderers inside the provider from the same framework and give them the same explicit `documentId`. Automatically generated IDs keep standalone renderers independent. React additionally requires `blockMemo` to remain enabled (its default) for cross-chunk coordination; Vue has no `blockMemo` prop.

Use stable component keys. Supply `documentIndex` when your sections can reorder or remount, so reference ordering follows the intended document order. Smooth turn-taking uses registration order, not `documentIndex`.

Different document IDs and different provider instances remain independent. Changing a section's document ID or unmounting it releases its old registration. Keep a provider scoped to the application area that owns those documents.

## Late definitions and footnotes

A reference can appear before its definition is available. Once mounted contributions commit, the registry supplies shared destinations and global footnote numbering. Updating or removing a definition updates its readers. The last chunk in registry order owns the aggregate footnote footer; `documentIndex` can change that order.

Server rendering and the first hydration render use local content and local footnotes. Definitions contributed only by other chunks are not pre-resolved in server HTML. If a complete server-rendered document is required, pass all of its source to a single renderer.

## Implement it in your framework

- [React document coordination](cross-chunk-coordination.md) covers the provider, registry hooks, ordering and cleanup.
- [Vue document coordination](vue-documents.md) covers Vue component keys, props and mounted contributions.
- [Core and engine contracts](api/core-engine-contracts.md) describe registration, publication and release for adapter authors.

Reference coordination and smooth turn-taking solve separate problems. Only smooth participants join the reveal queue. A section mounted with existing content keeps that content visible; an empty section can wait for an earlier smooth section to finish producing and draining.
