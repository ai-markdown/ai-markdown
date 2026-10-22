import { createMantineMarkdown } from './createMantineMarkdown';
import { MarkdownCodeBlock } from './rich/code';
export type { MantineAIMarkdownProps } from './createMantineMarkdown';
export const MantineAIMarkdown = createMantineMarkdown(MarkdownCodeBlock);
export default MantineAIMarkdown;
