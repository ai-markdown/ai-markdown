import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CodeLanguageFormat, resolveCodeHighlightLanguage } from '@ai-markdown/core/components';
import {
  behaviorDocument,
  createDemoHighlighter,
  fence,
  languageDocument,
  rendererDocument,
  samples,
  scenarioText,
  type DemoEngine,
  type DemoScenario,
} from '../common/codeHighlighting';
import type { HighlightDemoState } from '../common/codeHighlighting';
export type { HighlightDemoState } from '../common/codeHighlighting';
export function CodeHighlightingDemo({
  scenario,
  initialEngine,
  renderDocument,
}: {
  scenario: DemoScenario;
  initialEngine?: DemoEngine;
  renderDocument: (state: HighlightDemoState) => ReactNode;
}) {
  const [engine, setEngine] = useState<DemoEngine>(initialEngine ?? (scenario === 'legacy' ? 'Legacy' : 'Shiki'));
  const [colorScheme, setScheme] = useState<'light' | 'dark'>('light');
  const [language, setLanguage] = useState('tsx');
  const [count, setCount] = useState(samples.tsx.length);
  const [running, setRunning] = useState(false),
    [streaming, setStreaming] = useState(false);
  const [document, setDocument] = useState(0),
    [attempt, setAttempt] = useState(0);
  const [replacement, setReplacement] = useState(false);
  const highlighter = useMemo(
    () =>
      createDemoHighlighter(
        engine,
        ['loading', 'failure', 'theme'].includes(scenario) ? 800 : 0,
        scenario === 'failure' && attempt === 0
      ),
    [engine, scenario, attempt]
  );
  const code = replacement ? 'export const replacement: string = "new document";' : samples[language];
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => {
      const next = Math.min(count + 3, code.length);
      setCount(next);
      if (next >= code.length) {
        setRunning(false);
        setStreaming(false);
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [running, code, count]);
  const content =
    scenario === 'languages'
      ? languageDocument
      : scenario === 'behaviors'
        ? behaviorDocument
        : scenario === 'renderers'
          ? rendererDocument
          : fence(language, code.slice(0, count));
  return (
    <div
      className="aimd-highlight-demo"
      style={{
        padding: 16,
        background: colorScheme === 'dark' ? '#0d1117' : '#fff',
        color: colorScheme === 'dark' ? '#e6edf3' : '#24292f',
      }}
    >
      <p>{scenarioText[scenario]}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <label>
          Engine{' '}
          <select value={engine} onChange={(event) => setEngine(event.target.value as DemoEngine)}>
            {['highlight.js', 'Shiki', 'Pierre', 'Pierre (full frame)', 'Plain', 'Legacy'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Language{' '}
          <select
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value);
              setCount(10000);
            }}
          >
            {['tsx', 'jsx', 'vue', 'svelte', 'objc', 'txt', 'unknown'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button onClick={() => setScheme((v) => (v === 'dark' ? 'light' : 'dark'))}>Toggle theme</button>
        <button
          onClick={() => {
            setCount(0);
            setStreaming(true);
            setRunning(true);
          }}
        >
          Start stream
        </button>
        <button
          onClick={() => {
            setRunning((v) => !v);
            setStreaming(true);
          }}
        >
          Pause / resume
        </button>
        <button
          onClick={() => {
            setRunning(false);
            setStreaming(false);
            setCount(code.length);
          }}
        >
          Finish
        </button>
        <button
          onClick={() => {
            setReplacement((v) => !v);
            setCount(10000);
          }}
        >
          Replace code
        </button>
        <button onClick={() => setDocument((v) => v + 1)}>Switch document</button>
        <button onClick={() => setAttempt((v) => v + 1)}>Retry / reload engine</button>
      </div>
      <output>
        Engine: {engine}; theme: {colorScheme}; streaming: {String(streaming)}; document: {document}
      </output>
      {scenario === 'languages' && (
        <table>
          <thead>
            <tr>
              <th>Fence / effective</th>
              <th>highlight.js</th>
              <th>Shiki</th>
              <th>Pierre</th>
            </tr>
          </thead>
          <tbody>
            {['tsx', 'jsx', 'vue', 'svelte', 'objc', 'txt'].map((name) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{resolveCodeHighlightLanguage(name)}</td>
                <td>{resolveCodeHighlightLanguage(name, CodeLanguageFormat.Shiki)}</td>
                <td>{resolveCodeHighlightLanguage(name, CodeLanguageFormat.Pierre)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {renderDocument({ content, streaming, colorScheme, engine, highlighter, document, scenario })}
    </div>
  );
}
