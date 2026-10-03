'use client';

/**
 * Seeded streaming replay primitives (`useStreamedContent`, `StreamingReplay`,
 * the demo content). Stories consume them through `./streaming.tsx`, which
 * re-exports this module and adds the themed controls — keep importing from
 * there; this file stays presentation-free so it can be reused verbatim by
 * both packages' stories.
 */
import { useEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface UseStreamedContentOptions {
  chunkSizeMin?: number;
  chunkSizeMax?: number;
  chunkDelayMin?: number;
  chunkDelayMax?: number;
  /** Override the PRNG seed to get a different — but still repeatable — cadence. */
  seed?: number;
}

export interface StreamedContent {
  content: string;
  streaming: boolean;
  restart: () => void;
}

/**
 * Deterministic PRNG (mulberry32) — the same generator the benchmark
 * scenarios use. Chunk sizes and inter-chunk delays are jitter, not entropy:
 * seeding them means a replay produces the identical arrival pattern every
 * time, so a story that looks wrong can be looked at twice.
 */
const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Default seed for `useStreamedContent`. */
export const STREAM_JITTER_SEED = 0x5eed1e;

const randInt = (random: () => number, min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;

export const useStreamedContent = (
  fullText: string,
  {
    chunkSizeMin = 2,
    chunkSizeMax = 8,
    chunkDelayMin = 15,
    chunkDelayMax = 60,
    seed = STREAM_JITTER_SEED,
  }: UseStreamedContentOptions = {}
): StreamedContent => {
  // Keep intermediate renders in browser tests, with a bounded replay time.
  const testing = import.meta.env.MODE === 'test';
  const [position, setPosition] = useState(0);
  const [generation, restart] = useReducer((n: number) => n + 1, 0);
  const randomRef = useRef<() => number>(mulberry32(seed));

  useEffect(() => {
    // Reset streaming position when the source text or generation counter changes.
    // This is a deliberate state-reset effect; eslint-plugin-react-hooks@7 flags
    // synchronous setState-in-effect as a cascade-render hazard, but here it's
    // the only correct way to reset *this* hook's local state when one of its
    // inputs changes from the outside. Storybook-demo code only.
    // Reseeding here (and not in the timer effect) is what makes a restart
    // replay the exact same cadence as the first run.
    randomRef.current = mulberry32(seed);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPosition(0);
  }, [fullText, generation, seed]);

  useEffect(() => {
    if (position >= fullText.length) return;
    const random = randomRef.current;
    const size = testing ? 128 : randInt(random, chunkSizeMin, chunkSizeMax);
    const delay = testing ? 1 : randInt(random, chunkDelayMin, chunkDelayMax);
    const id = window.setTimeout(() => {
      setPosition((prev) => Math.min(fullText.length, prev + size));
    }, delay);
    return () => window.clearTimeout(id);
  }, [position, fullText, chunkSizeMin, chunkSizeMax, chunkDelayMin, chunkDelayMax, testing]);

  return {
    content: fullText.slice(0, position),
    streaming: position < fullText.length,
    restart,
  };
};

/**
 * Shared shell for the streaming demo stories (core and mantine): a replay
 * button above the streamed markdown. Each package styles its own button
 * (`renderButton`) and renders its own markdown component (`children`) —
 * what's shared is the hook wiring and the button-over-content layout, and,
 * because this is a real component (not a story `render` slot calling hooks
 * directly), consumers don't need a rules-of-hooks suppression.
 */
export const StreamingReplay = ({
  text,
  options,
  style,
  renderButton,
  children,
}: {
  /** Full markdown document to stream. */
  text: string;
  options?: UseStreamedContentOptions;
  /** Style for the wrapping div (e.g. theme text color). */
  style?: CSSProperties;
  renderButton: (streaming: boolean, restart: () => void) => ReactNode;
  children: (content: string, streaming: boolean) => ReactNode;
}) => {
  const { content, streaming, restart } = useStreamedContent(text, options);
  return (
    <div style={style} data-story-streaming={streaming}>
      {renderButton(streaming, restart)}
      {children(content, streaming)}
    </div>
  );
};

export { SHOWCASE as STREAMING_DEMO_CONTENT } from '../common/corpus';
