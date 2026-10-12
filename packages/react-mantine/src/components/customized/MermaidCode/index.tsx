'use client';

import {
  createDiagramController,
  diagramErrorText,
  resolveLabels,
  type DiagramError,
  type DiagramView,
} from '@ai-markdown/core/components';

import React, { memo, useEffect, useRef, useState, useCallback } from 'react';
import { CodeHighlightControl, CodeHighlightTabs } from '@mantine/code-highlight';
import { ActionIcon, CopyButton, Flex, Text, Tooltip } from '@mantine/core';
import type mermaidModule from 'mermaid';
import { CheckIcon, CodeIcon, DiagramIcon } from './icons';
import { useAIMarkdownState, useAIMarkdownTheme } from '@ai-markdown/react';
import { defaultMantineMermaidLabels, type MantineCodeBlockOptions } from '../../../defs';
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
type MermaidView = { kind: 'source' } | { kind: 'diagram'; chartType: string } | DiagramError;

/** Equality used to skip no-op view updates — repeat mid-stream successes
 *  of the same chart type must not re-render the host per chunk. */
const toMermaidView = (view: DiagramView): MermaidView =>
  view.kind === 'diagram' ? { kind: 'diagram', chartType: view.chartType } : view;

const sameView = (a: MermaidView, b: MermaidView): boolean => {
  if (a.kind === 'diagram' && b.kind === 'diagram') return a.chartType === b.chartType;
  // Core publishes an error only when it differs from the one before it.
  if (a.kind === 'error' && b.kind === 'error') return a === b;
  return a.kind === b.kind;
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
 * The render state machine is core's `createDiagramController`: what happens
 * while the source streams, when the stream ends, when a render fails and
 * when the engine cannot be downloaded is documented there. This component
 * draws what it publishes and adds the Mantine controls.
 *
 * @param props.code - Raw mermaid diagram source code to render.
 */
const MantineAIMMermaidCode = memo((props: { code: string; options?: Partial<MantineCodeBlockOptions> }) => {
  const { colorScheme, fontSize } = useAIMarkdownTheme();
  const { streaming } = useAIMarkdownState();
  const {
    defaultExpanded,
    mermaidIntervalMs,
    mermaidLabels: configuredLabels,
  } = useMantineCodeBlockOptions(props.options);
  const labels = resolveLabels(defaultMantineMermaidLabels, configuredLabels);
  const isDark = colorScheme === 'dark';
  const ref = useRef<HTMLPreElement>(null);
  const [view, setViewState] = useState<MermaidView>({ kind: 'source' });
  const [showOriginalCode, setShowOriginalCode] = useState(false);
  // The controller is created in an effect, because what it publishes is drawn
  // into the host element. The SVG goes straight into the host, and React state
  // keeps only what the chrome needs, so a repeat success of the same chart type
  // does not re-render it.
  const [machine] = useState<{ controller?: ReturnType<typeof createDiagramController> }>(() => ({}));
  useEffect(() => {
    machine.controller ??= createDiagramController(loadMermaid, ({ view: next }) => {
      const host = ref.current;
      if (host) {
        if (next.kind === 'diagram') {
          host.innerHTML = next.svg;
          next.bind?.(host);
        } else if (next.kind === 'source') {
          host.innerHTML = '';
        }
      }
      const shown = toMermaidView(next);
      setViewState((prev) => (sameView(prev, shown) ? prev : shown));
    });
    // The source view suspends attempts; coming back with the same source and theme renders nothing.
    machine.controller.update({
      code: props.code,
      dark: isDark,
      streaming,
      active: !showOriginalCode,
      interval: mermaidIntervalMs,
    });
  }, [machine, props.code, isDark, streaming, showOriginalCode, mermaidIntervalMs]);
  useEffect(() => () => machine.controller?.dispose(), [machine]);

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
              fileName: view.kind === 'error' ? labels.errorTitle : 'mermaid',
              code: props.code,
              language: 'mermaid',
            },
          ]}
          defaultExpanded={defaultExpanded}
          expandCodeLabel={labels.expand}
          collapseCodeLabel={labels.collapse}
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
                    tooltipLabel={labels.renderTooltip}
                    aria-label={labels.render}
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
          {diagramErrorText(view, labels)}
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
              <Tooltip label={labels.openInNewWindowTooltip}>
                <ActionIcon
                  size={28}
                  className="action-icon"
                  variant="transparent"
                  aria-label={labels.openInNewWindow}
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
            <Tooltip label={labels.showCodeTooltip}>
              <ActionIcon
                size={28}
                className="action-icon"
                variant="transparent"
                aria-label={labels.showCode}
                onClick={() => {
                  setShowOriginalCode(true);
                }}
              >
                <CodeIcon />
              </ActionIcon>
            </Tooltip>
            <CopyButton value={props.code}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? labels.copiedTooltip : labels.copyTooltip} withArrow position="right">
                  <ActionIcon
                    variant="transparent"
                    size={28}
                    className="action-icon"
                    aria-label={copied ? labels.copied : labels.copy}
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
