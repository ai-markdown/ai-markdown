import { type DefineComponent, defineComponent, h, onMounted, onUnmounted, ref } from 'vue';
import { footnoteSafeId } from '@ai-markdown/engine';
/** Vue owns layout observation; engine/core never read browser globals. */
export const AIMarkdownStreamingCursor = defineComponent({
  name: 'AIMarkdownStreamingCursor',
  setup(_props, { slots }) {
    const shell = ref<HTMLElement>();
    let mutation: MutationObserver | undefined;
    let resize: ResizeObserver | undefined;
    let frame = 0;
    let root: HTMLElement | null = null;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    function measure() {
      frame = 0;
      const marker = shell.value;
      if (!marker || !root) return;
      marker.style.visibility = 'hidden';
      const signal = root.querySelector<HTMLElement>(':scope > [data-aimd-tail-kind]');
      if (signal?.dataset.aimdTailKind === 'invisible-def') return;
      let target: Element = root;
      if (signal?.dataset.aimdTailKind === 'footnote-def') {
        const id = `${signal.dataset.aimdClobberPrefix}fn-${footnoteSafeId(signal.dataset.aimdTailLabel ?? '')}`;
        const li = Array.from(root.querySelectorAll('[data-footnotes] li')).find((node) => node.id === id);
        if (!li) return;
        target = li;
      }
      // Follow only the actual trailing branch. A code/math/image tail hides
      // the cursor rather than pointing at an earlier paragraph.
      let node: Node | undefined = target;
      const safe = new Set([
        'DIV',
        'P',
        'SPAN',
        'STRONG',
        'EM',
        'DEL',
        'MARK',
        'A',
        'BLOCKQUOTE',
        'UL',
        'OL',
        'LI',
        'H1',
        'H2',
        'H3',
        'H4',
        'H5',
        'H6',
      ]);
      while (node?.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (!safe.has(element.tagName) || element.classList.contains('katex')) return;
        node = [...element.childNodes].reverse().find((child) => {
          if (child === marker || child.nodeType === Node.COMMENT_NODE) return false;
          if (child.nodeType === Node.TEXT_NODE) return !!child.textContent?.trim();
          return (
            child instanceof Element &&
            !child.matches('[data-footnotes], [data-footnote-backref], [data-aimd-tail-kind]')
          );
        });
      }
      if (!node || node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return;
      const end = node.textContent.trimEnd().length;
      const last = Array.from(node.textContent.slice(0, end)).at(-1)!;
      const range = document.createRange();
      range.setStart(node, end - last.length);
      range.setEnd(node, end);
      const rect = Array.from(range.getClientRects()).at(-1);
      if (!rect || !rect.height) return;
      const box = root.getBoundingClientRect();
      const scale = root.offsetWidth ? box.width / root.offsetWidth : 1;
      // DOM rectangles start at the border edge; absolute offsets start at
      // the padding edge, including an RTL scrollbar on the left.
      const rtl = getComputedStyle(node.parentElement!).direction === 'rtl';
      marker.style.left = `${((rtl ? rect.left : rect.right) - box.left) / scale + root.scrollLeft - root.clientLeft}px`;
      marker.style.top = `${(rect.top - box.top) / scale + root.scrollTop - root.clientTop}px`;
      marker.style.height = `${rect.height / scale}px`;
      marker.style.lineHeight = `${rect.height / scale}px`;
      marker.style.transform = rtl ? 'translateX(-100%)' : '';
      marker.style.visibility = 'visible';
    }
    onMounted(() => {
      root = shell.value?.parentElement ?? null;
      if (!root) return;
      mutation = new MutationObserver(schedule);
      mutation.observe(root, { childList: true, characterData: true, subtree: true });
      resize = new ResizeObserver(schedule);
      resize.observe(root);
      window.addEventListener('resize', schedule);
      root.addEventListener('scroll', schedule, true);
      schedule();
    });
    onUnmounted(() => {
      mutation?.disconnect();
      resize?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      root?.removeEventListener('scroll', schedule, true);
    });
    return () =>
      h(
        'span',
        {
          ref: shell,
          class: 'aimd-vue-cursor',
          'aria-hidden': 'true',
          style: { position: 'absolute', pointerEvents: 'none', visibility: 'hidden' },
        },
        slots.default?.() ?? '▍'
      );
  },
}) as DefineComponent;
