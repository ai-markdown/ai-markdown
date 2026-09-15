/**
 * Walk an mdast tree and yield ref/def records in source order. Used by
 * AIMarkdownContent's PASS 1 contribute step to populate Registry.chunkData.
 *
 * Phantom definitions (Direction B) carry sentinel content/url but the
 * sentinel parse may not produce exactly the sentinel string at the AST
 * level (e.g. `__aimd_sentinel_fn__` parses as <strong>aimd_sentinel_fn</strong>).
 * Therefore phantom detection is done both ways:
 *   - linkDef: check `url === SENTINEL_LINK_URL` (raw string survives parsing).
 *   - fnDef: skip if the def's normalized identifier is in the supplied
 *            `phantomFootnoteLabels` set. The caller knows which labels it
 *            injected (PASS 0.5 `targetPhantoms.missingFootnotes`).
 *
 * @module components/extractContributions
 */
import type { Nodes as MdastNode, Root as MdastRoot } from 'mdast';
import { normalizeId } from './normalizeId';
import { SENTINEL_LINK_URL } from './remarkInjectPhantomDefs';

export type Contribution =
  | {
      kind: 'ref';
      refKind: 'footnote' | 'link' | 'image';
      label: string;
      referenceType?: 'full' | 'collapsed' | 'shortcut';
      /** Normalized label of the footnote definition whose body holds this
       *  reference. Emitted for footnote references only; see the walk. */
      nestedIn?: string;
    }
  | { kind: 'fnDef'; label: string; sourceIdentifier: string; content: string }
  | { kind: 'linkDef'; label: string; url: string; title?: string };

export interface ExtractContributionsOptions {
  /** Already-normalized labels that were phantom-injected at PASS 0.5.
   *  Defs matching these are skipped to avoid leaking sentinel rows into
   *  registry.chunkData. */
  phantomFootnoteLabels?: Set<string>;
  // NOTE: link-definition URLs are emitted RAW. A former `urlTransform`
  // option applied the caller's transform at contribute time as a
  // "belt-and-suspenders" pass; it collapsed a protocol-blocked URL to ''
  // BEFORE the render-time gate could tell blocked (attribute absent) from
  // legally empty (`href=""`), and a rewriting transform ran twice
  // (contribute + render) where standalone runs once. The render-time
  // `resolveCrossChunkReference` gate (schema, hash rebasing, urlTransform)
  // is the single point of enforcement and mirrors the standalone pipeline
  // exactly (v2.4.2 review P1-4). `sanitizeCrossChunkUrl` is the older
  // URL-only helper and is not on the adapters' render path.
}

export function* extractContributions(
  mdast: MdastRoot,
  options: ExtractContributionsOptions = {}
): Generator<Contribution> {
  const phantomFn = options.phantomFootnoteLabels;
  const out: Contribution[] = [];
  // Definitions are document-wide wherever they sit. CommonMark resolves a
  // `[x]` anywhere against a `[x]: url` written inside a footnote body, and
  // mdast-util-to-hast collects footnote definitions at every depth, so a
  // `[^b]:` nested in `[^a]:`'s body renders its own `<li>`. The PASS 0
  // scanner (`collectDefLabels`) walks the whole tree for the same reason;
  // this extractor has to claim exactly the same label set, or a sibling
  // chunk phantom-injects a label it can never resolve. Hence the walk
  // descends into footnote definition bodies; `inBody` is the normalized
  // label of the innermost definition whose body holds the current node,
  // or null at flow level.
  const walk = (n: MdastNode, inBody: string | null): void => {
    if (n.type === 'footnoteReference') {
      // A footnote ref inside a def body is emitted with `nestedIn` set, and
      // is NOT a flow ref. It takes part in numbering — standalone numbers a
      // footnote that only a body references, after the flow refs — but it
      // must not be counted as an occurrence: `[^x]: see [^a].` would
      // otherwise inflate `getRefsForLabel('a')` so the aggregate emits a
      // backref anchor to `#fnref-a-2` that no inline `<sup>` ever rendered.
      out.push({
        kind: 'ref',
        refKind: 'footnote',
        label: normalizeId(n.identifier),
        ...(inBody !== null ? { nestedIn: inBody } : {}),
      });
      return;
    }
    if (n.type === 'linkReference' || n.type === 'imageReference') {
      // Link and image refs inside a body are not recorded: the registry
      // has no consumer for them (no numbering, no counts).
      if (inBody === null) {
        out.push({
          kind: 'ref',
          refKind: n.type === 'linkReference' ? 'link' : 'image',
          label: normalizeId(n.identifier),
          referenceType: n.referenceType,
        });
      }
      // Fall through: link text can itself hold an image reference
      // (`[![alt][img]][lnk]`), which is a flow ref of its own.
    } else if (n.type === 'footnoteDefinition') {
      const label = normalizeId(n.identifier);
      // Skip phantom-injected (by injected-label set, since the sentinel
      // string may not survive markdown parsing intact). Its body is the
      // sentinel and contains nothing to contribute.
      if (phantomFn?.has(label)) return;
      // Best-effort raw content snapshot: stringify the first child's
      // structure. Footnote definitions are typed `(BlockContent | DefinitionContent)[]`
      // so we serialize loosely. Used only as a coarse fingerprint string.
      const content = JSON.stringify(n.children);
      // n.identifier is mdast's already-case-folded form — the same string
      // mdast-util-to-hast uses in `<li id="...fn-${id}">`. Tracked separately
      // from the uppercase-normalized `label` (used as a dictionary key) so
      // HTML ids built downstream match the inline sup's href byte-for-byte.
      //
      // bodyHast is NOT computed here — see extractDefBodiesFromHast for
      // why we source it from the post-pipeline hast instead.
      out.push({ kind: 'fnDef', label, sourceIdentifier: n.identifier, content });
      for (const child of n.children) walk(child, label);
      return;
    } else if (n.type === 'definition') {
      const d = n as { identifier: string; url: string; title?: string };
      if (d.url === SENTINEL_LINK_URL) return;
      out.push({
        kind: 'linkDef',
        label: normalizeId(d.identifier),
        url: d.url,
        title: d.title,
      });
      return;
    }
    if ('children' in n) for (const child of n.children) walk(child, inBody);
  };
  walk(mdast, null);
  for (const c of out) yield c;
}
