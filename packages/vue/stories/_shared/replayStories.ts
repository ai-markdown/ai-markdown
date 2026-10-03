import { QUOTES, SHOWCASE } from '@ai-markdown/storybook-kit/common/corpus';
import { useCorpusReplay } from '@ai-markdown/storybook-kit/vue/replay';
import type { StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { h } from 'vue';
import AIMarkdown, { AIMarkdownSmoothStream } from '../../src';
type Story = StoryObj;
export function replay(smooth: boolean) {
  return {
    setup() {
      const { content, streaming: live, restart: start, finish, cancel: stop, replace } = useCorpusReplay(SHOWCASE);
      return () =>
        h('section', [
          h('button', { onClick: start }, 'Replay corpus'),
          h(
            'button',
            {
              onClick: () => {
                finish();
              },
            },
            'Finish'
          ),
          h(
            'button',
            {
              onClick: () => {
                replace(QUOTES);
              },
            },
            'Replace'
          ),
          h('button', { onClick: stop }, 'Cancel'),
          h('output', live.value ? 'Receiving' : 'Idle'),
          !content.value && !live.value
            ? h(
                'p',
                { class: 'aim-demo-hint' },
                'Replay the sample to watch Markdown arrive, then try finish, replace or cancel.'
              )
            : null,
          h(smooth ? AIMarkdownSmoothStream : AIMarkdown, {
            content: content.value,
            streaming: live.value,
            ...(smooth ? { pacing: 'responsive' as const } : {}),
          }),
        ]);
    },
  };
}
export const play: NonNullable<Story['play']> = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Replay corpus' }));
  await waitFor(() => expect(canvasElement.querySelector('strong')).not.toBeNull());
  await userEvent.click(canvas.getByRole('button', { name: 'Finish' }));
  await waitFor(() => expect(canvasElement.querySelector('[aria-busy="true"]')).toBeNull(), { timeout: 10000 });
  await waitFor(() => {
    const lastFormula = Array.from(canvasElement.querySelectorAll('.katex annotation')).at(-1);
    expect(lastFormula?.textContent?.trim()).toBe(SHOWCASE.split('$$').at(-2)?.trim());
  });
  await userEvent.click(canvas.getByRole('button', { name: 'Replace' }));
  await waitFor(() => {
    expect(canvasElement.querySelector('blockquote')).not.toBeNull();
    expect(canvasElement.textContent).not.toContain('inline-emphasis');
  });
  await userEvent.click(canvas.getByRole('button', { name: 'Replay corpus' }));
  await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
  expect(canvas.getByRole('status')).toHaveTextContent('Idle');
};
