'use client';

import { mermaidRenderQueue } from './renderQueue';
import { ensureMermaidInitialized, getMermaidMaxTextSize } from './initialize';
import { useCodeFrame } from '../useCodeFrame';

import React, { memo, useEffect, useRef, useState, useCallback } from 'react';
import { CodeHighlightControl, CodeHighlightTabs } from '@mantine/code-highlight';
import { ActionIcon, CopyButton, Flex, Text, Tooltip } from '@mantine/core';
import type mermaidModule from 'mermaid';
import { CheckIcon, CodeIcon, DiagramIcon } from './icons';
import { useAIMarkdownState, useAIMarkdownTheme } from '@ai-markdown/react';
import type { MantineCodeBlockOptions } from '../../../defs';
import { useMantineCodeBlockOptions } from '../../../hooks/useMantineCodeBlockOptions';
import './styles.scss';

/** Static `<pre>` style for the mermaid container. */
const PRE_STYLE = { cursor: 'pointer', overflow: 'auto', width: '100%', padding: '0.5rem' } as const;

/**
 * What the component currently shows. One value instead of separate
 * `hasRendered`/`renderError`/`chartType` fields whose combinations had to
 * be kept coherent by hand:
 * - `source`: warm-up / SSR fallback — raw code as a plain code block
 *   (nothing rendered yet this generation).
 * - `diagram`: the last successful SVG is up.
 * - `error`: the error tab — only a post-stream corrective failure or a
 *   never-rendered static failure can enter this state.
 *
 * The user's source toggle (`showOriginalCode`) is deliberately NOT a
 * phase: it overlays any view and flipping it back must restore the prior
 * one unchanged.
 */
type MermaidView = { kind: 'source' } | { kind: 'diagram'; chartType: string } | { kind: 'error'; message: string };

/** Equality used to skip no-op view updates — repeat mid-stream successes
 *  of the same chart type must not re-render the host per chunk. */
const sameView = (a: MermaidView, b: MermaidView): boolean => {
  if (a.kind === 'diagram' && b.kind === 'diagram') return a.chartType === b.chartType;
  if (a.kind === 'error' && b.kind === 'error') return a.message === b.message;
  return a.kind === b.kind;
};

/** Longest error text shown under the error tab. mermaid's parse errors are
 *  a few lines ("Parse error on line 3: ... Expecting ..."); anything longer
 *  is noise. */
const ERROR_MESSAGE_MAX_CHARS = 500;

/**
 * The failure reason as plain text for the error tab, so the user can find
 * the failing line. Only ever rendered as a text node — never as HTML — and
 * capped in length. Non-Error throws (mermaid throws strings in places) are
 * stringified the same way.
 */
const describeRenderError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return 'Mermaid could not render this diagram.';
  return text.length > ERROR_MESSAGE_MAX_CHARS ? `${text.slice(0, ERROR_MESSAGE_MAX_CHARS)}…` : text;
};

type Mermaid = typeof mermaidModule;

/**
 * mermaid is loaded on demand — the FIRST diagram that actually renders
 * pays the import; an app whose content never contains a mermaid fence
 * never downloads the ~1.5 MB module (2026-08 project review,
 * pkg-small-03: the static import sat on the default `pre` component's
 * import chain, so every consumer's main bundle carried it). The promise is
 * cached module-wide; the source-view warm-up covers the loading window.
 */
let mermaidPromise: Promise<Mermaid> | null = null;
/** Bounded automatic retries of a failed mermaid module download. */
const MERMAID_LOAD_RETRIES = 3;
const MERMAID_LOAD_RETRY_MS = 1500;
const loadMermaid = (): Promise<Mermaid> => {
  // A rejected load is not cached — the next render attempt retries.
  mermaidPromise ??= import('mermaid').then(
    (m) => m.default,
    (err: unknown) => {
      mermaidPromise = null;
      throw err;
    }
  );
  return mermaidPromise;
};

/**
 * Generate a unique ID for mermaid SVG rendering.
 * Combines a timestamp with a random suffix to avoid collisions when
 * multiple mermaid diagrams render concurrently.
 *
 * @returns A unique string in the format `mermaid-{timestamp}-{random}`.
 */
const generateMermaidUUID = () => {
  return `mermaid-${new Date().getTime()}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Open the rendered mermaid SVG in a new browser window.
 *
 * Clones the SVG element, applies a background color matching the current
 * color scheme, serializes it to an object URL, and opens it in a new tab.
 * The object URL is revoked after a short delay to free memory.
 *
 * @param svgElement - The rendered SVG element to view, or `null`/`undefined` to no-op.
 * @param isDark - Whether the current color scheme is dark (used for background color).
 */
const handleViewSVGInNewWindow = (svgElement: SVGElement | null | undefined, isDark: boolean) => {
  if (!svgElement) return;
  const targetSvg = svgElement.cloneNode(true) as SVGElement;
  targetSvg.style.backgroundColor = isDark ? '#242424' : 'white';
  const text = new XMLSerializer().serializeToString(targetSvg);
  const blob = new Blob([text], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  // The blob URL is same-origin — object URLs inherit the origin that made
  // them — so this opens as a top-level document in the application's own
  // origin, and reviews keep flagging it. Examined and kept as it is on
  // 2026-08-20 (do not re-report):
  //
  // Loading the SVG as a document does revive `<script>` elements that sit
  // inertly in our `innerHTML` (the HTML parser flags scripts inserted that
  // way non-executable, and a fresh parse does not carry the flag over).
  // What that misses is that inline `on*` handlers inserted the same way are
  // NOT inert — `<img src=x onerror>` fires in the page — and neither are
  // `javascript:` hrefs or `<animate>` retargeting one. Anything that
  // reaches the DOM with a script vector intact therefore already holds the
  // page's origin, without a popup. The escalation is only real for markup
  // where `<script>` survives sanitizing while every handler in the same
  // injection channel does not, which is not the shape a DOMPurify bypass
  // takes; and a host CSP with `script-src 'self'` closes even that, since
  // blob documents inherit the creator's policy.
  //
  // `noopener` stays for the ordinary reason — the new context does not need
  // a handle on this window — not as an answer to the above, which it never
  // was.
  window.open(url, '_blank', 'noopener');
  // Revoke either way (a blocked popup would otherwise leak the Blob until
  // page unload — 2026-08 project review, pkg-small-09). With `noopener`
  // `window.open` returns null even on success, so the blocked case cannot
  // be told apart any more: always give the opened document the grace
  // period to finish loading before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

/**
 * Interactive mermaid diagram renderer.
 *
 * Parses and renders mermaid diagram source code into an inline SVG visualization.
 * Automatically adapts to the current Mantine color scheme (light/dark) by
 * re-initializing mermaid with the appropriate theme.
 *
 * Features:
 * - Live SVG rendering with automatic dark/light theme switching
 * - Fallback to raw source code display on parse/render errors
 * - Toggle between rendered diagram and raw mermaid source
 * - Click on the rendered diagram to open the SVG in a new browser window
 * - Copy button for the raw mermaid source code
 * - Chart type label extracted from mermaid's parse result
 * - Preserves the last successful render across transient parse failures
 *
 * ## Streaming contract
 *
 * While `streaming` is true (from render state), the code prop is usually a
 * truncated prefix of the final diagram, so parse failures are *expected*,
 * not exceptional:
 * - Before the first successful render, the raw source is shown as a plain
 *   code block (never the error tab).
 * - After a success, the last good SVG stays up; each subsequent chunk is
 *   re-attempted and the diagram refreshes only on the next success.
 * - When streaming ends (`streaming` is an effect dep), one corrective pass
 *   runs on the final code: success refreshes the diagram, failure surfaces
 *   the real error tab — even over a previously rendered mid-stream diagram,
 *   because that diagram no longer matches the final source. The pending
 *   corrective obligation is tracked by `needsCorrectiveRef` (armed on the
 *   streaming→false edge, consumed by the next completed attempt), so ONLY
 *   that one pass may clobber a rendered diagram; any later failure (e.g. a
 *   transient throw on a theme-flip re-render) falls back to the static rule
 *   below.
 * - A streaming→true edge marks a NEW generation (chat "regenerate" reuses
 *   the same component instance when the block's source offset — and thus
 *   its React key — is unchanged). All per-generation state is reset so the
 *   warm-up shows the new source instead of the previous generation's stale
 *   diagram or error tab.
 * - Render attempts are throttled by `codeBlock.mermaidIntervalMs`: the
 *   source the render effect sees (`renderCode`) is a trailing-throttled
 *   frame of `props.code`, so a fast stream costs at most one parse + render
 *   per interval instead of one per idle moment. The queue alone only
 *   merged pending attempts; with a synchronous layout per render, the
 *   main thread was still busy back to back. The frame flushes at once on
 *   completion and replacement, so the corrective pass always sees the final
 *   source; the source fallback and the copy button keep the latest
 *   `props.code`.
 *
 * ## Static contract (`streaming` stays false)
 *
 * Without streaming edges, failures follow the original conservative rule:
 * the error tab shows only while nothing has rendered yet. Once a diagram is
 * up, later failures (theme-flip re-render, a not-yet-complete `code` update
 * from a consumer that didn't pass `streaming`) keep the last good diagram
 * instead of clobbering it with an error.
 *
 * @param props.code - Raw mermaid diagram source code to render.
 */
const MantineAIMMermaidCode = memo((props: { code: string; options?: Partial<MantineCodeBlockOptions> }) => {
  const { colorScheme, fontSize } = useAIMarkdownTheme();
  const { streaming } = useAIMarkdownState();
  const { defaultExpanded, mermaidIntervalMs } = useMantineCodeBlockOptions(props.options);
  const isDark = colorScheme === 'dark';
  // The throttled source for the render effect (see "Streaming contract").
  // Same trailing throttle as ordinary code display: appends within an
  // interval replace one pending frame without moving its deadline; a
  // non-streaming update, completion or replacement passes through at once.
  const renderCode = useCodeFrame(props.code, 'mermaid', streaming, mermaidIntervalMs);

  const ref = useRef<HTMLPreElement>(null);
  const renderVersionRef = useRef(0);
  /** Mirrors `view` for reads inside the async render closure — state reads
   *  there can be stale when deps change mid-flight. */
  const viewRef = useRef<MermaidView>({ kind: 'source' });
  /** Previous `streaming` value, for edge detection in the effect. */
  const prevStreamingRef = useRef(false);
  /** Armed on the streaming→false edge: the next completed render attempt is
   *  the end-of-stream corrective pass, whose failure must surface even over
   *  a rendered diagram. Consumed (reset) by that attempt's success OR
   *  surfaced failure, so later unrelated failures can't clobber the SVG. */
  const needsCorrectiveRef = useRef(false);
  /** Inputs of the render whose SVG currently sits in the host `<pre>`.
   *  When the effect re-runs with the same (code, theme) pair — the
   *  post-stream corrective flip on an already-final diagram, or returning
   *  from the source view — the DOM already holds that exact render, so
   *  the attempt (and its parse + temp-element render) is skipped. */
  const lastSuccessRef = useRef<{ code: string; isDark: boolean } | null>(null);
  const [view, setViewState] = useState<MermaidView>({ kind: 'source' });
  const [showOriginalCode, setShowOriginalCode] = useState(false);
  /** Bumped (after a short delay) when the mermaid MODULE failed to load, so
   *  the effect re-runs on otherwise unchanged inputs and retries the
   *  download. A download failure is not a diagram error: it must neither
   *  consume the corrective obligation nor show the error tab (v2.4.1
   *  review — the corrective pass is one-shot, so a transient network
   *  failure on it left a permanent "Render Error" that nothing re-tried).
   *  Bounded by MERMAID_LOAD_RETRIES per generation. */
  const [loadAttempt, setLoadAttempt] = useState(0);
  const loadFailuresRef = useRef(0);

  useEffect(() => {
    // View updates funnel through here so the ref mirror can't desync from
    // the state, and no-op updates are dropped (repeat mid-stream successes
    // and idempotent edge resets must not re-render the host per chunk).
    const applyView = (next: MermaidView) => {
      viewRef.current = next;
      setViewState((prev) => (sameView(prev, next) ? prev : next));
    };

    // Streaming edge detection MUST run before any early return — the first
    // chunk of a new stream can arrive while the code is still empty.
    if (streaming && !prevStreamingRef.current) {
      // Rising edge = a new generation is starting on this same instance
      // (same block offset → same React key → no remount on regenerate).
      // Reset all per-generation state so warm-up shows the incoming source,
      // not the previous generation's stale diagram or error tab. Everything
      // here is idempotent — a StrictMode double-run is harmless.
      needsCorrectiveRef.current = false;
      lastSuccessRef.current = null;
      loadFailuresRef.current = 0;
      applyView({ kind: 'source' });
      if (ref.current) {
        ref.current.innerHTML = '';
      }
    } else if (!streaming && prevStreamingRef.current) {
      // Falling edge = the stream just ended; arm the corrective pass.
      needsCorrectiveRef.current = true;
    }
    prevStreamingRef.current = streaming;
    if (!renderCode || !ref.current || showOriginalCode) {
      return;
    }

    // The SVG in the DOM already came from exactly this (code, theme) pair —
    // nothing to recompute. This also SATISFIES a pending corrective
    // obligation: the identical successful render IS the verdict on the
    // final source, so the obligation is consumed, not left armed for some
    // later unrelated failure to inherit.
    if (lastSuccessRef.current?.code === renderCode && lastSuccessRef.current.isDark === isDark) {
      needsCorrectiveRef.current = false;
      return;
    }

    const renderVersion = ++renderVersionRef.current;
    let cancelled = false;

    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const renderMermaid = async () => {
      let mermaid: Mermaid;
      try {
        mermaid = await loadMermaid();
      } catch {
        // Module load failed: keep whatever is showing (source view or the
        // last diagram), leave the corrective obligation armed, and retry
        // the download a bounded number of times.
        if (cancelled || renderVersion !== renderVersionRef.current) return;
        if (loadFailuresRef.current < MERMAID_LOAD_RETRIES) {
          loadFailuresRef.current += 1;
          retryTimer = setTimeout(() => setLoadAttempt((n) => n + 1), MERMAID_LOAD_RETRY_MS);
        }
        return;
      }
      loadFailuresRef.current = 0;
      try {
        if (!ref.current || cancelled || renderVersion !== renderVersionRef.current) {
          return;
        }
        ensureMermaidInitialized(mermaid, isDark);
        // Size gate before parse: `mermaid.render` would otherwise resolve
        // with a placeholder diagram for oversized input, and this component
        // would record that as a success. The raw length is compared; mermaid
        // measures the text after stripping front matter and directives, so
        // a source within a few bytes of the limit can be refused here that
        // mermaid would still have rendered.
        const maxTextSize = getMermaidMaxTextSize(mermaid);
        if (renderCode.length > maxTextSize) {
          throw new Error(
            `Diagram source is ${renderCode.length} characters, above mermaid's maxTextSize of ${maxTextSize}.`
          );
        }
        const parseResult = await mermaid.parse(renderCode);
        if (!parseResult) {
          throw new Error('Failed to parse mermaid code');
        }

        if (!ref.current || cancelled || renderVersion !== renderVersionRef.current) {
          return;
        }

        // Deliberately NOT passing `ref.current` as mermaid's
        // svgContainingElement: before the first success the host container
        // is hidden with `display: none` (source fallback is showing), and
        // mermaid measures text via getBBox during render — inside a
        // display:none subtree layout never runs, every measurement is 0,
        // and the diagram comes out as a ~16px SVG. With the argument
        // omitted, mermaid renders in a temp element appended to
        // `document.body` (its default path, cleaned up internally), so
        // measurement works no matter what our container is doing. The SVG
        // string is written into our own <pre> below either way.
        // The queue holds initialization, parsing and rendering together,
        // so another library instance cannot change the theme mid-task.
        const rendered = await mermaid.render(generateMermaidUUID(), renderCode);
        const { svg, bindFunctions, diagramType } = rendered;
        if (!ref.current || cancelled || renderVersion !== renderVersionRef.current) {
          return;
        }

        ref.current.innerHTML = svg;
        bindFunctions?.(ref.current);
        needsCorrectiveRef.current = false;
        lastSuccessRef.current = { code: renderCode, isDark };
        applyView({ kind: 'diagram', chartType: diagramType });
      } catch (error) {
        if (cancelled || renderVersion !== renderVersionRef.current) {
          return;
        }
        // Mid-stream failures are expected (truncated code) — keep the last
        // good diagram / source placeholder and wait for more bytes. The
        // corrective pass after streaming ends reports real errors.
        if (streaming) {
          return;
        }
        const message = describeRenderError(error);
        // End-of-stream corrective pass: the final source no longer renders,
        // so the error must surface even over a mid-stream diagram. Consume
        // the obligation so later unrelated failures don't inherit it.
        if (needsCorrectiveRef.current) {
          needsCorrectiveRef.current = false;
          applyView({ kind: 'error', message });
          return;
        }
        // Static rule: never clobber a rendered diagram (theme-flip
        // re-renders, un-flagged code updates from static consumers).
        if (viewRef.current.kind === 'diagram') {
          return;
        }
        applyView({ kind: 'error', message });
      }
    };

    const owner = renderVersionRef;
    void mermaidRenderQueue.enqueue(owner, renderMermaid);

    return () => {
      cancelled = true;
      mermaidRenderQueue.cancel(owner);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
    // `streaming` in the deps is what drives the end-of-stream corrective
    // pass: the flip to false re-runs this effect on the (unchanged) final
    // code, so the last state reflects the full diagram source.
    // `loadAttempt` re-runs it after a failed module download.
  }, [renderCode, isDark, showOriginalCode, streaming, loadAttempt]);

  const viewSvgInNewWindow = useCallback(() => {
    handleViewSVGInNewWindow(ref.current?.querySelector('svg'), isDark);
  }, [isDark]);

  // Show the raw source instead of the diagram container when the user asked
  // for it, when the (post-stream) render failed, or before the first
  // successful render (SSR output and the streaming warm-up phase). The
  // diagram container below stays MOUNTED throughout — merely hidden — so
  // `ref` is always available for mermaid to render into; unmounting it would
  // make the effect's `!ref.current` guard bail forever.
  const showSourceFallback = showOriginalCode || view.kind !== 'diagram';

  return (
    <>
      {showSourceFallback && (
        <CodeHighlightTabs
          mb={15}
          fz={fontSize}
          w="100%"
          code={[
            {
              fileName: view.kind === 'error' ? 'Mermaid Render Error' : 'mermaid',
              code: props.code,
              language: 'mermaid',
            },
          ]}
          defaultExpanded={defaultExpanded}
          maxCollapsedHeight="320px"
          styles={{
            filesScrollarea: {
              right: '90px',
            },
          }}
          controls={
            // The "Render Mermaid" control only makes sense as the way back
            // from the user-toggled source view. In the error and warm-up
            // fallbacks `showOriginalCode` is already false, so the control
            // would be a no-op — hide it there. (No view-kind conjunct: the
            // toggle is only reachable from the visible diagram view, and
            // while the source view is open the effect early-returns, so
            // showOriginalCode && view.kind === 'error' is unreachable.)
            showOriginalCode
              ? [
                  <CodeHighlightControl
                    tooltipLabel="Render Mermaid"
                    aria-label="Render Mermaid diagram"
                    key="gpt"
                    onClick={() => {
                      setShowOriginalCode(false);
                    }}
                  >
                    <DiagramIcon size={16} />
                  </CodeHighlightControl>,
                ]
              : []
          }
          withBorder
          withExpandButton
        />
      )}
      {view.kind === 'error' && !showOriginalCode && (
        // The reason, as a text node only: React escapes it, and nothing here
        // goes through innerHTML. `pre-wrap` keeps mermaid's line/column
        // pointer lines aligned so the failing line can be found.
        <Text
          component="pre"
          role="status"
          className="aim-mantine-mermaid-error"
          fz="xs"
          c="red"
          mt={-10}
          mb={15}
          style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}
        >
          {view.message}
        </Text>
      )}
      <div
        className={`aim-mantine-mermaid-code ${isDark ? 'dark' : ''}`}
        style={
          showSourceFallback
            ? {
                display: 'none',
              }
            : {}
        }
      >
        <div className="chart-header">
          <div className="chart-type-tag">{view.kind === 'diagram' ? view.chartType : 'unknown'}</div>
          <Flex align="center" justify="flex-end" gap={0}>
            {/* The "open in a new window" action is a real button here rather
                than a `role="button"` on the SVG container: a button's
                content is presentational to assistive tech, so the diagram's
                own text and mermaid's accTitle/accDescr were unreachable, and
                any `click … href` link mermaid emitted sat inside a button
                (invalid, not tabbable) — 2026-08-19 review r2 P3. The
                container below carries no role at all, for the same reason. */}
            {/* Always rendered (also under SSR / the source warm-up, where it
                is a no-op until the SVG exists) so server and client markup
                agree. */}
            {
              <Tooltip label="Open in new window">
                <ActionIcon
                  size={28}
                  className="action-icon"
                  variant="transparent"
                  aria-label="Open Mermaid diagram in a new window"
                  onClick={viewSvgInNewWindow}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    strokeWidth="2"
                    stroke="currentColor"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    width="18px"
                    height="18px"
                    aria-hidden="true"
                  >
                    <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                    <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"></path>
                    <path d="M11 13l9 -9"></path>
                    <path d="M15 4h5v5"></path>
                  </svg>
                </ActionIcon>
              </Tooltip>
            }
            <Tooltip label="Show Mermaid Code">
              <ActionIcon
                size={28}
                className="action-icon"
                variant="transparent"
                aria-label="Show Mermaid code"
                onClick={() => {
                  setShowOriginalCode(true);
                }}
              >
                <CodeIcon />
              </ActionIcon>
            </Tooltip>
            <CopyButton value={props.code}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow position="right">
                  <ActionIcon
                    variant="transparent"
                    size={28}
                    className="action-icon"
                    aria-label={copied ? 'Mermaid code copied' : 'Copy Mermaid code'}
                    onClick={copy}
                  >
                    {copied ? (
                      <CheckIcon />
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        strokeWidth="2"
                        stroke="currentColor"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        width="18px"
                        height="18px"
                        aria-hidden="true"
                      >
                        <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                        <path d="M8 8m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z"></path>
                        <path d="M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2"></path>
                      </svg>
                    )}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Flex>
        </div>
        {/* No ARIA role on the container: `role="img"` (like the old
            `role="button"`) makes its children presentational and hides the
            SVG's own `role="graphics-document"` + accTitle/accDescr that
            mermaid emits — the SVG names itself. Click-to-open stays as a
            pointer convenience; the keyboard/AT path is the header button. */}
        <pre ref={ref} style={PRE_STYLE} onClick={viewSvgInNewWindow} />
      </div>
    </>
  );
});

MantineAIMMermaidCode.displayName = 'MantineAIMMermaidCode';

export default MantineAIMMermaidCode;
