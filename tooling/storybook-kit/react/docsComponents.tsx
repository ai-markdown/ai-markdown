import type { ComponentProps } from 'react';

/** MDX-only code fences have no primary CSF story. Render their supplied text
 * directly instead of routing it through Storybook's story-source resolver. */
export const docsComponents = {
  pre: (props: ComponentProps<'pre'>) => <pre {...props} className="aim-docs-code" />,
  code: (props: ComponentProps<'code'>) => <code {...props} />,
};
