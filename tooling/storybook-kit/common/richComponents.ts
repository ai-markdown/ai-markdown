/** The same direct-registration example for both adapters. Photos use a stable Picsum seed. */
export const RICH_COMPONENTS_EXAMPLE = [
  '## Code, images and tables',
  '```json',
  '{"message":"Copy keeps the original source","count":3}',
  '```',
  '```mermaid',
  'graph LR; Markdown-->Components; Components-->React; Components-->Vue',
  '```',
  '',
  'Click the image below to open its preview.',
  '',
  '![Sample photo from Picsum](https://picsum.photos/seed/ai-markdown-preview/200/300)',
  '',
  '| Component | Registration |',
  '| :-- | :-- |',
  '| Code + Mermaid | `pre` |',
  '| Image preview | `img` |',
  '| Table export | `table` |',
].join('\n');

export const IMAGE_GALLERY_EXAMPLE = [
  '## Image gallery',
  'Hover or focus an image, then open the preview. Use the arrow keys to browse.',
  '',
  '![Gallery photo one](https://picsum.photos/seed/ai-markdown-mountain/480/320)',
  '',
  '![Gallery photo two](https://picsum.photos/seed/ai-markdown-coast/480/320)',
  '',
  '![Gallery photo three](https://picsum.photos/seed/ai-markdown-forest/480/320)',
].join('\n');
