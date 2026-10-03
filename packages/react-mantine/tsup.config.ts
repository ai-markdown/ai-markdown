import { defineConfig } from 'tsup';
import { sassPlugin } from 'esbuild-sass-plugin';
import postcss from 'postcss';
import autoprefixer from 'autoprefixer';

export default defineConfig({
  entry: { index: 'src/index.tsx', components: 'src/components.tsx' },
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom', '@mantine/core', '@ai-markdown/react'],
  esbuildPlugins: [
    sassPlugin({
      async transform(source) {
        const { css } = await postcss([autoprefixer]).process(source, { from: undefined });
        return css;
      },
    }),
  ],
});
