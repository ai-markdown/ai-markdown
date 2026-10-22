import { expect, userEvent, waitFor, within } from 'storybook/test';
export async function checkStreaming(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Start stream' }));
  await waitFor(() => expect(canvasElement.querySelector('code')?.textContent).toContain('export'));
  await userEvent.click(canvas.getByRole('button', { name: 'Pause / resume' }));
  await userEvent.click(canvas.getByRole('button', { name: 'Finish' }));
  await waitFor(() => expect(canvasElement.querySelector('code')?.textContent).toContain('</strong>'));
  await userEvent.click(canvas.getByRole('button', { name: 'Replace code' }));
  await waitFor(() => expect(canvasElement.querySelector('code')?.textContent).toContain('replacement'));
  await userEvent.click(canvas.getByRole('button', { name: 'Switch document' }));
  await waitFor(() => expect(canvasElement.textContent).toContain('document: 1'));
}
export async function checkLoading(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvasElement.querySelector('[data-highlight-status="loading"]')).not.toBeNull());
  await userEvent.selectOptions(canvas.getByLabelText('Language'), 'vue');
  await waitFor(
    () =>
      expect(
        canvasElement.querySelector('[data-highlight-language="vue"][data-highlight-status="ready"]')
      ).not.toBeNull(),
    { timeout: 15000 }
  );
  expect(canvasElement.querySelector('code')?.textContent).toContain('<template>');
}
export async function checkTheme(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Toggle theme' }));
  await waitFor(() => expect(canvasElement.querySelector('[data-highlight-status="ready"]')).not.toBeNull(), {
    timeout: 15000,
  });
  expect(canvasElement.textContent).toContain('theme: dark');
}
export async function checkLanguages(canvasElement: HTMLElement) {
  await waitFor(
    () => {
      for (const language of ['tsx', 'jsx', 'vue', 'svelte', 'objective-c'])
        expect(
          canvasElement.querySelector(`[data-highlight-language="${language}"][data-highlight-status="ready"]`)
        ).not.toBeNull();
    },
    { timeout: 15000 }
  );
  expect(canvasElement.querySelector('code script')).toBeNull();
}

/** Exercise the real WASM runtime, including source that Markdown normalizes before rendering. */
export async function checkPierreSourceIntegrity() {
  const { createDemoHighlighter } = await import('./codeHighlighting');
  const adapter = createDemoHighlighter('Pierre')!;
  for (const code of ['', '\n\n', 'const 中文 = "😀";\r\n\r\n', '<script>alert("x")</script>\n']) {
    const request = { code, language: 'typescript', colorScheme: 'light' as const };
    await adapter.prepare?.(request);
    const result = adapter.highlight(request);
    expect(result && 'tokens' in result && result.tokens.map((token) => token.text).join('')).toBe(code);
  }
  expect(adapter.supports?.('unknown')).toBe(false);
  const code = 'export const hello: string = "world";';
  const light = adapter.highlight({ code, language: 'typescript', colorScheme: 'light' });
  const dark = adapter.highlight({ code, language: 'typescript', colorScheme: 'dark' });
  expect(light).not.toEqual(dark);
}

export async function checkPierreIncremental() {
  const { createDemoHighlighter, samples } = await import('./codeHighlighting');
  const adapter = createDemoHighlighter('Pierre')!;
  await adapter.prepare?.({ code: '', language: 'tsx', colorScheme: 'light' });
  const normalize = (result: ReturnType<typeof adapter.highlight>) =>
    result && 'tokens' in result
      ? result.tokens.flatMap((token) =>
          Array.from(token.text)
            .filter((char) => !/[\r\n]/.test(char))
            .map((char) => [char, token.color, token.backgroundColor, token.fontStyle])
        )
      : [];
  for (const language of ['tsx', 'vue', 'svelte', 'typescript']) {
    const backend = adapter.createSession!();
    const sources = [
      samples[language] ?? '/* comment\ncontinued */\nconst 中文 = "😀";\r\n\r\n',
      'replaced\r\nconst x = 2;',
      '',
    ];
    for (const source of sources) {
      for (let i = 0; i <= source.length; i++) {
        const request = { code: source.slice(0, i), language, colorScheme: 'light' as const, streaming: true };
        const incremental = backend.highlight(request);
        expect(incremental && 'tokens' in incremental && incremental.tokens.map((token) => token.text).join('')).toBe(
          request.code
        );
        expect(normalize(incremental)).toEqual(normalize(adapter.highlight(request)));
      }
      const dark = { code: source, language, colorScheme: 'dark' as const, streaming: true };
      expect(normalize(backend.highlight(dark))).toEqual(normalize(adapter.highlight(dark)));
    }
    backend.dispose();
  }
}

/** HAST's trailing newline must not turn every mid-line append into a fresh WASM instance. */
export async function checkPierreMarkdownFrames() {
  const [{ createPierreHighlightAdapter }, runtime, { default: theme }] = await Promise.all([
    import('@ai-markdown/core/components'),
    import('@pierre/highlights'),
    import('@pierre/highlights/themes/github-light-high-contrast'),
  ]);
  let instances = 0;
  class TrackedLiveTokenizer extends runtime.LiveTokenizer {
    constructor(options: ConstructorParameters<typeof runtime.LiveTokenizer>[0]) {
      super(options);
      instances++;
    }
  }
  const adapter = createPierreHighlightAdapter({
    load: async () => ({ ...runtime, LiveTokenizer: TrackedLiveTokenizer, themes: { light: theme, dark: theme } }),
  });
  await adapter.prepare?.({ code: '', language: 'typescript', colorScheme: 'light' });
  const source = '/* 中文😀\r\ncontinued */\nexport const value = "hi";\r\n';
  for (const suffix of ['\n', '\r\n']) {
    instances = 0;
    const backend = adapter.createSession!();
    for (let end = 0; end <= source.length; end++) {
      const request = {
        code: source.slice(0, end) + suffix,
        language: 'typescript',
        colorScheme: 'light' as const,
        streaming: true,
      };
      const actual = backend.highlight(request),
        full = adapter.highlight(request);
      const normalize = (result: typeof actual) =>
        result && 'tokens' in result
          ? result.tokens.flatMap((token) =>
              Array.from(token.text)
                .filter((char) => !/[\r\n]/.test(char))
                .map((char) => [char, token.color, token.fontStyle, token.backgroundColor])
            )
          : [];
      expect(actual && 'tokens' in actual && actual.tokens.map((token) => token.text).join('')).toBe(request.code);
      expect(normalize(actual)).toEqual(normalize(full));
    }
    expect(instances).toBe(1);
    backend.dispose();
  }
}
