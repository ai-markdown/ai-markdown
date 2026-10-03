import type { Element } from 'hast';
export interface MarkdownComponentProps {
  node?: Element;
  streaming?: boolean;
  metadata?: unknown;
}
