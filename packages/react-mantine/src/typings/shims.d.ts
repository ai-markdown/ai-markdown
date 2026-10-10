/**
 * Ambient declarations for style imports. The styles are compiled and bundled
 * by the tsdown build (@tsdown/css) or served by vite (storybook); for
 * `tsc --noEmit` the import only needs to resolve. `*.css` exists for the
 * storybook program (tsconfig.storybook.json includes this typings dir):
 * TypeScript 6's `noUncheckedSideEffectImports` default rejects side-effect
 * imports it cannot resolve, and story files import stylesheet packages.
 */
declare module '*.scss';
declare module '*.css';
