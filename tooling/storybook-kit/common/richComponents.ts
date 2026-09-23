/** The same direct-registration example for both adapters. All assets local. */
export const RICH_COMPONENTS_EXAMPLE = [
  '## Code, images and tables',
  '```json',
  '{"message":"Copy keeps the original source","count":3}',
  '```',
  '```mermaid',
  'graph LR; Markdown-->Components; Components-->React; Components-->Vue',
  '```',
  'Click this image to preview it: ![Local placeholder](/placeholder-200x300.svg)',
  '',
  '| Component | Registration |',
  '| :-- | :-- |',
  '| Code + Mermaid | `pre` |',
  '| Image preview | `img` |',
  '| Table export | `table` |',
].join('\n');
