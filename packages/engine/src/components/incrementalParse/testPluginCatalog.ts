/**
 * TEST-ONLY helper (imported by the incrementalParse test files; never by
 * production code or the package barrel).
 *
 * Builds `AdvanceOptions` that mirror `MarkdownContent.tsx`'s standalone
 * assembly EXACTLY — same plugin order as the `remarkPlugins`/`rehypePlugins`
 * memos, same merged remark-rehype options as the `parsed` memo (standalone
 * default: `preserveOrphanReferences` → only the `footnoteDefinition`
 * handler, empty phantom label sets, `preserveOrphan: true`, documentId).
 * The splice-equivalence arbiter derives its authority from this mirroring:
 * if the option assembly here drifts from the component's, the arbiter
 * stops testing the production pipeline. Cross-check against
 * `MarkdownContent.tsx` (plugin memos + `parsed` memo) when either changes;
 * `byteEquivalence.test.tsx`'s `legacyPlugins()` pins the same order.
 *
 * The permutation catalog spans the config axes the way
 * `byteEquivalence.test.tsx` does — including ALL-DEFAULTS-ON, which the
 * original prefixFreeze experiment did not cover (hole H2).
 */

import { defListHastHandlers } from 'remark-definition-list';

import { sanitizeSchema } from '../sanitizeSchema';
import { buildCoreRehypePlugins, buildCoreRemarkPlugins } from '../pluginChain';
import { buildCrossChunkHandlers } from '../customMdastHandlers';
import { highlight, definitionList, removeComments, smartypants, pangu } from '../../plugins/catalog';
import type { AdvanceOptions } from './advanceIncrementalParse';
import type { FreezeBoundaryOptions } from './computeFreezeBoundary';

/**
 * The grammar capability the adapters declare on top of the plugin chain:
 * `buildCoreRemarkPlugins` always includes remark-gfm, so React and Vue
 * pass `gfmTaskListItems: true` (MarkdownContent.tsx, useMarkdownChunk.ts).
 * `buildAdvanceOptions` deliberately leaves it UNSET — that is the
 * conservative default a generic `advanceIncrementalParse` caller gets,
 * and `taskListTaint.test.ts` pins it — so the harnesses that mirror the
 * production lineage spread this in explicitly.
 */
export const ADAPTER_GRAMMAR = { gfmTaskListItems: true } as const;

/** The scanner profile the production engine lineage runs a catalog
 *  config under (`advanceIncrementalParse` → `computeFreezeBoundary`). */
export function scannerProfile(config: CatalogConfig): FreezeBoundaryOptions {
  return { defListEnabled: config.defList, ...ADAPTER_GRAMMAR };
}

export interface CatalogConfig {
  label: string;
  highlight: boolean;
  defList: boolean;
  removeComments: boolean;
  smartypants: boolean;
  pangu: boolean;
  /** `preserveOrphanReferences` OFF flips the standalone handlers memo to
   *  `undefined` (no footnoteDefinition handler) AND `preserveOrphan: false`
   *  — orphan defs then emit no footer `<li>`. The injection replay must be
   *  exact under BOTH modes (it replays events; the handlers decide). */
  preserveOrphan: boolean;
}

export const CATALOG: CatalogConfig[] = [
  {
    label: 'baseline',
    highlight: false,
    defList: false,
    removeComments: false,
    smartypants: false,
    pangu: false,
    preserveOrphan: true,
  },
  {
    label: 'defaults-all-on',
    highlight: true,
    defList: true,
    removeComments: true,
    smartypants: true,
    pangu: true,
    preserveOrphan: true,
  },
  {
    label: 'def-list-only',
    highlight: false,
    defList: true,
    removeComments: false,
    smartypants: false,
    pangu: false,
    preserveOrphan: true,
  },
  {
    label: 'display-only',
    highlight: false,
    defList: false,
    removeComments: true,
    smartypants: true,
    pangu: true,
    preserveOrphan: true,
  },
  {
    label: 'no-orphan',
    highlight: false,
    defList: false,
    removeComments: false,
    smartypants: false,
    pangu: false,
    preserveOrphan: false,
  },
  // The realistic production shape of the flag-off mode: a user sets
  // preserveOrphanReferences=false while keeping every DEFAULT plugin on
  // (final-review R4 — without this cell, a replay regression that needs
  // the default footer path COMBINED with text-mutating plugins would pass
  // the whole catalog).
  {
    label: 'defaults-no-orphan',
    highlight: true,
    defList: true,
    removeComments: true,
    smartypants: true,
    pangu: true,
    preserveOrphan: false,
  },
];

const TEST_DOCUMENT_ID = 'ip';
const TEST_CLOBBER_PREFIX = `${encodeURIComponent(TEST_DOCUMENT_ID)}-user-content-`;
/** ONE credential for the handler options AND the chain — the two must
 *  agree or the verifier unwraps every placeholder the handlers emit, and
 *  the arbiter's placeholder assertions (`spliceEquivalence`) go dark. */
export const TEST_PROVENANCE = 'test-provenance';
const EMPTY_SET: ReadonlySet<string> = new Set();

/** Coordinated-mode mirror: ALL FOUR cross-chunk handlers, non-empty
 *  phantom label sets (labels pre-normalized/uppercased, as PASS 0.5
 *  produces them), `preserveOrphan: true` (preserveForBodyHarvest is
 *  always true once a chunk holds a registry Symbol). The corresponding
 *  parse input is `content + buildPhantomSuffix(phantoms)`.
 *
 *  `config` is optional only for the historical no-plugin cell. It was
 *  HARD-CODED to that cell until 2026-08-26, while the sole production
 *  caller (`MarkdownContent.tsx`'s `advanceIncrementalParse` branch) runs
 *  the user's real plugin selection and `defListEnabled` alongside the
 *  phantom suffix — so the production-reachable combination was never
 *  driven (review M-xchunk). Pass a catalog config to cover it. */
export function buildCrossChunkAdvanceOptions(
  phantomFootnoteLabels: ReadonlySet<string>,
  phantomLinkLabels: ReadonlySet<string>,
  config?: CatalogConfig
): AdvanceOptions {
  const remarkRehypeOptions = {
    allowDangerousHtml: true,
    clobberPrefix: '',
    handlers: {
      ...(config?.defList ? defListHastHandlers : {}),
      ...buildCrossChunkHandlers(),
    },
    phantomFootnoteLabels,
    phantomLinkLabels,
    preserveOrphan: true,
    documentId: TEST_DOCUMENT_ID,
    provenance: TEST_PROVENANCE,
  };
  return {
    remarkPlugins: buildCoreRemarkPlugins(config ? enginePluginsFor(config) : []),
    rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, TEST_CLOBBER_PREFIX, { provenance: TEST_PROVENANCE }),
    remarkRehypeOptions: remarkRehypeOptions as never,
    depsKey: ['cross-chunk', config?.label ?? 'no-plugins'],
    defListEnabled: config?.defList ?? false,
  };
}

/** The sealed plugin selection a catalog config names, in the shipped
 *  order — shared by both option builders so they cannot drift. */
function enginePluginsFor(config: CatalogConfig) {
  return [
    ...(config.highlight ? [highlight] : []),
    ...(config.defList ? [definitionList] : []),
    ...(config.removeComments ? [removeComments] : []),
    ...(config.smartypants ? [smartypants] : []),
    ...(config.pangu ? [pangu] : []),
  ];
}

export function buildAdvanceOptions(config: CatalogConfig): AdvanceOptions {
  // Standalone default mode: preserveOrphanReferences=true → ONLY the
  // footnoteDefinition handler; OFF → no custom footnote handler at all
  // (MarkdownContent.tsx `handlers` memo).
  const { footnoteDefinition } = buildCrossChunkHandlers();
  const remarkRehypeOptions = {
    allowDangerousHtml: true,
    clobberPrefix: '',
    handlers: {
      ...(config.defList ? defListHastHandlers : {}),
      ...(config.preserveOrphan ? { footnoteDefinition } : {}),
    },
    phantomFootnoteLabels: EMPTY_SET,
    phantomLinkLabels: EMPTY_SET,
    preserveOrphan: config.preserveOrphan,
    documentId: TEST_DOCUMENT_ID,
    provenance: TEST_PROVENANCE,
  };

  // The chains come from pluginChain.ts — the SAME builders MarkdownContent
  // calls, so the arbiter can never drift from the shipped order (the axes
  // here map onto the sealed plugin selection the production memos consume).
  const options: AdvanceOptions = {
    remarkPlugins: buildCoreRemarkPlugins(enginePluginsFor(config)),
    rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, TEST_CLOBBER_PREFIX, { provenance: TEST_PROVENANCE }),
    remarkRehypeOptions: remarkRehypeOptions as never,
    depsKey: [config.label],
    defListEnabled: config.defList,
  };
  return options;
}
