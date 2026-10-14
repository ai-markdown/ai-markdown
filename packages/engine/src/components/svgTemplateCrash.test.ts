/**
 * `<svg><template>` used to CRASH the whole render — not an under-block, a
 * thrown `TypeError: Cannot read properties of undefined (reading
 * 'nodeName')` out of `hast-util-from-parse5`, reachable from any markdown
 * containing that raw-HTML pair (streaming irrelevant; the full parse threw
 * too, and `rehype-parse` users are equally affected upstream).
 *
 * Root cause: upstream reads `.content` on every element named `template`,
 * but parse5 — per the HTML spec — attaches template contents only to an
 * HTML-namespace template. Inside `<svg>`/`<math>` a `<template>` is an
 * ordinary foreign element whose children live in `childNodes` and whose
 * `.content` is undefined.
 *
 * Fixed in the `@ai-markdown` fork chain the engine now depends on:
 * `@ai-markdown/rehype-raw` → `@ai-markdown/hast-util-raw` →
 * `@ai-markdown/hast-util-from-parse5` (upstream + one-line guard). This
 * test pins the engine-level behaviour so a future dependency change that
 * silently swaps the chain back to upstream turns the crash into a red test
 * instead of a production incident.
 *
 * The guard reads the parse5 node (`'content' in node`), not the namespace.
 * A namespace check alone is not enough: `hastscript` reads a tag name as a
 * selector, so an HTML-namespace `<template.x>` becomes a hast `template`
 * whose parse5 node has no `content`. Markdown does not accept `.` or `#` in a
 * tag name, so those shapes reach the HTML parser only inside a raw HTML
 * block, which is why they are wrapped in a `<div>`. They come from
 * syntax-tree/hast-util-from-parse5#15; keep them when the fork is replaced
 * by an upstream release.
 */
import { describe, expect, test } from 'vitest';
import { CATALOG } from './incrementalParse/testPluginCatalog';
import { assertStreamEquivalence, runFull } from './incrementalParse/spliceArbiterHarness';
import { scheduleSnapshots } from './incrementalParse/fuzzGenerators';

const SHAPES = [
  '<svg><template>x</template></svg>',
  '<math><template>x</template></math>',
  '<svg><template>',
  'prose <svg><template>x</template></svg> after',
  '<svg>\n<template>y</template>\n</svg>',
  '<div>\n<template.x>hi</template.x>\n</div>',
  '<div>\n<template#a>hi</template#a>\n</div>',
  '<div>\n<svg><template#a>hi</template#a></svg>\n</div>',
  '<div>\n<math><template.y>hi</template.y></math>\n</div>',
];

describe('svg/math template does not crash the render', () => {
  test('full parse survives every shape on every config', () => {
    for (const config of CATALOG) {
      for (const shape of SHAPES) {
        const doc = `before\n\n${shape}\n\nafter\n`;
        expect(() => runFull(doc, config), `${config.label} :: ${shape}`).not.toThrow();
      }
    }
  });

  test('streaming survives and stays equivalent', () => {
    for (const shape of SHAPES) {
      const doc = `before\n\n${shape}\n\nafter\n\nmore\n`;
      assertStreamEquivalence(shape, scheduleSnapshots(doc, [4, 4, 4, 4, 4, 4, 4, 4]), CATALOG[0]);
    }
  }, 60_000);
});
