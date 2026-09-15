/** Per-consumer parse state and full/incremental fallback policy.
 * The host decides whether a next frame is expected (false for SSR), owns
 * this session, and resets it when render policy invalidates retained trees.
 * Parsing does not register chunks or publish document contributions.
 * Fallback order: incremental → full pipeline → plain-text frame, the last
 * step ONLY for the engine's raw-depth signal (see plainTextTrees); any
 * other full-pipeline throw, a consumer plugin's included, escapes `parse`.
 */
import {
  EngineRawHtmlDepthError,
  advanceIncrementalParse,
  buildPhantomSuffix,
  phantomSuffixCloser,
  parseStage,
  transformStage,
  type IncrementalParseState,
  type PipelineOptions,
  type AdvanceOptions,
} from '@ai-markdown/engine';

import type { Root as MdastRoot } from 'mdast';
import type { Root as HastRoot } from 'hast';

export interface PipelineTrees {
  mdast: MdastRoot;
  hast: HastRoot;
}
export interface PipelineSession {
  /** Drop retained incremental state. Does not dispose host subscriptions. */
  reset(): void;
  /** Read-only borrowed trees: clone before destructive rendering. */
  parse(options: PipelineFrameOptions): PipelineTrees;
}

type RemarkRehypeOptions = NonNullable<PipelineOptions['remarkRehypeOptions']>;
export interface PipelineFrameOptions {
  content: string;
  targetPhantoms: { missingFootnotes: Set<string>; missingLinks: Set<string> };
  remarkPlugins: PipelineOptions['remarkPlugins'];
  rehypePlugins: PipelineOptions['rehypePlugins'];
  remarkRehypeOptions: PipelineOptions['remarkRehypeOptions'];
  handlers?: RemarkRehypeOptions['handlers'];
  preserveForBodyHarvest: boolean;
  documentId: string;
  provenance: string;
  /** False for a one-shot server render; no browser-global probe is needed. */
  incrementalParse: boolean;
  defListEnabled: boolean;
  /** Whether `remarkPlugins` parses GFM task-list items. Default `false`
   *  (the boundary scanner keeps every `[x]` as reference taint). The
   *  adapters pass `true` because they build the chain with
   *  `buildCoreRemarkPlugins`, which always includes remark-gfm. */
  gfmTaskListItems?: boolean;
  measure?: AdvanceOptions['measure'];
}
const unmeasured: NonNullable<AdvanceOptions['measure']> = (_stage, fn) => fn();

/** Line/column/offset of the end of `text`, in the parser's convention
 *  (1-based line and column, 0-based offset). Counts what micromark counts:
 *  `\n`, `\r\n` and a lone `\r` are one line ending each. */
function endPoint(text: string): { line: number; column: number; offset: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10 /* \n */ || (code === 13 /* \r */ && text.charCodeAt(i + 1) !== 10)) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: text.length - lineStart + 1, offset: text.length };
}

/**
 * Last-resort trees for a frame whose FULL parse threw the engine's
 * `EngineRawHtmlDepthError`: the whole source as one plain-text paragraph,
 * positions covering the entire content so the planner, cache keys and
 * custom components see well-formed nodes. The text is a hast text node — it
 * renders escaped, never as markup.
 *
 * Why this exists: the incremental path already falls back to the full
 * pipeline, but the full pipeline itself can throw — a few thousand nested
 * raw `<div>` tags exhaust the call stack of a recursive walker after the
 * raw-HTML step (the walk itself, or an adapter renderer further on) — and
 * nothing above the session caught it, so one hostile message took the
 * adapter subtree down. The engine's guarded raw step bounds element depth
 * and reports a deeper frame as a typed error; nothing else is degraded,
 * because a throwing consumer plugin or handler is a bug the host must see,
 * not a frame to render as text. The next frame is parsed normally again
 * (retained state is cleared).
 */
function plainTextTrees(content: string): PipelineTrees {
  const position = { start: { line: 1, column: 1, offset: 0 }, end: endPoint(content) };
  const text = { type: 'text' as const, value: content, position };
  return {
    mdast: { type: 'root', children: [{ type: 'paragraph', children: [text], position }], position },
    hast: {
      type: 'root',
      children: [{ type: 'element', tagName: 'p', properties: {}, children: [text], position }],
      position,
    },
  };
}

export function createPipelineSession(): PipelineSession {
  let state: IncrementalParseState | null = null;
  return {
    reset(): void {
      state = null;
    },
    parse({
      content,
      targetPhantoms,
      remarkPlugins,
      rehypePlugins,
      remarkRehypeOptions,
      handlers,
      preserveForBodyHarvest,
      documentId,
      provenance,
      incrementalParse,
      defListEnabled,
      gfmTaskListItems = false,
      measure: measureHere = unmeasured,
    }: PipelineFrameOptions) {
      // The suffix is APPENDED (the engine treats it as an always-tail
      // input; prepending would shift every source position). A frame that
      // ends inside an open fence / `$$` block would swallow it — sentinel
      // lines rendered as code, every cross-chunk ref falling back to
      // literal text for the block's whole streaming lifetime — so the
      // engine first emits an output-neutral closer for that block (see
      // phantomSuffixCloser; '' when nothing is open or the phase is
      // untrusted). Only chunks with a non-empty suffix pay the line scan.
      const phantomDefs = buildPhantomSuffix(targetPhantoms);
      const phantomSuffix = phantomDefs === '' ? '' : phantomSuffixCloser(content ?? '') + phantomDefs;
      const augmented = (content ?? '') + phantomSuffix;
      const baseHandlers = remarkRehypeOptions?.handlers ?? {};
      const mergedRemarkRehypeOptions = (
        handlers
          ? {
              ...remarkRehypeOptions,
              handlers: { ...baseHandlers, ...handlers },
              // Phantom label sets are empty in standalone mode (no PASS 0.5
              // injection happened); the footnoteDefinition handler still reads
              // them via `state.options.phantomFootnoteLabels.has(id)`, which
              // returns false for every id → orphan-protect path proceeds.
              phantomFootnoteLabels: targetPhantoms.missingFootnotes,
              phantomLinkLabels: targetPhantoms.missingLinks,
              preserveOrphan: preserveForBodyHarvest,
              documentId,
              // The SAME value `buildCoreRehypePlugins` received — the
              // verifier unwraps every placeholder stamped with anything else.
              provenance,
            }
          : {
              ...remarkRehypeOptions,
            }
      ) as RemarkRehypeOptions;

      // Coordinated (registry) mode is incremental-eligible since v2: the
      // engine takes the phantom suffix as a separate always-tail input (its
      // frame-to-frame churn re-parses only the tail — the reference taint
      // keeps every phantom-resolved ref out of the frozen prefix), and the
      // contribute effect's inputs are covered by splice equivalence (mdast)
      // plus the replay-regenerated footer (hast). When the flag is off, the
      // state is CLEARED — a later eligible frame must never splice against
      // trees parsed under different conditions.
      //
      // SSR takes this branch too: the engine's first-frame scan exists to
      // seed the NEXT frame's checkpoint, and a per-request server render
      // has no next frame — routing through the engine would pay a dead
      // O(document) line-lex per request. Hydration is unaffected (the
      // client's first frame rebuilds from null either way).
      // The ordinary full pipeline, with the plain-text last resort around
      // it for the engine's raw-depth signal only (see plainTextTrees).
      // Dev-only stage telemetry (`ai-markdown:stage:*` performance
      // measures; no-op in production) wraps only the stage calls — the
      // surrounding option assembly is trivial.
      const fullPipeline = (): PipelineTrees => {
        try {
          const parsed = measureHere('parse', () =>
            parseStage({
              children: augmented,
              remarkPlugins,
              rehypePlugins,
              remarkRehypeOptions: mergedRemarkRehypeOptions,
            })
          );
          const hastRoot = measureHere('transform', () => transformStage(parsed));
          return { mdast: parsed.mdast, hast: hastRoot };
        } catch (error) {
          // Only the engine's own signal for raw HTML nested past its depth
          // bound is degraded. Everything else — a consumer's remark/rehype
          // plugin or handler throwing, a RangeError that is not that
          // signal — propagates exactly as it did before the fallback
          // existed.
          if (!(error instanceof EngineRawHtmlDepthError)) throw error;
          if (process.env.NODE_ENV !== 'production') {
            console.error(
              '[ai-react-markdown] raw HTML nested past the engine depth bound — rendering this frame as plain text:',
              error
            );
          }
          return plainTextTrees(content ?? '');
        }
      };

      if (!incrementalParse) {
        state = null;
        return fullPipeline();
      }

      try {
        const result = advanceIncrementalParse(state, content ?? '', {
          remarkPlugins,
          rehypePlugins,
          remarkRehypeOptions: mergedRemarkRehypeOptions,
          // Identity tuple over every parse input beyond the content itself.
          // Deliberately covers MORE than the G3 flush's 12 fields (handlers /
          // preserveForBodyHarvest / documentId can change without touching
          // any G3 field — e.g. a `preserveOrphanReferences` flip). The
          // phantom label sets are deliberately NOT here: their churn tracks
          // the suffix (always re-parsed with the tail), never the prefix.
          depsKey: [
            remarkPlugins,
            rehypePlugins,
            remarkRehypeOptions,
            handlers,
            preserveForBodyHarvest,
            documentId,
            // Explicit even though `rehypePlugins` already carries it: a
            // credential change must never reuse trees stamped under the
            // old one.
            provenance,
            // The boundary scanner's grammar profile. The scan checkpoint
            // already refuses to resume under a different profile, but the
            // retained TREES were still spliced against — a prefix frozen
            // under one profile must not survive into frames under the other.
            defListEnabled,
            gfmTaskListItems,
          ],
          defListEnabled,
          gfmTaskListItems,
          phantomSuffix,
          measure: measureHere,
        });
        state = result.nextState;
        return { mdast: result.mdast, hast: result.hast };
      } catch (error) {
        // The engine mutates prev's scan checkpoint IN PLACE before the tail
        // parse/splice — a throw mid-frame (an engine bug, or a plugin
        // choking on the synthetic tail source) leaves the retained state's
        // checkpoint describing content the state's trees do not. Clearing
        // the ref restores the "state is CLEARED when unusable" discipline;
        // the frame then renders via the ordinary full pipeline so one bad
        // frame cannot take the surface down.
        state = null;
        if (process.env.NODE_ENV !== 'production') {
          console.error('[ai-react-markdown] incremental parse failed — full parse fallback for this frame:', error);
        }
        return fullPipeline();
      }
    },
  };
}
