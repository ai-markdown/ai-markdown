/* global window, document, performance, MessageChannel, TextEncoder */
// A fixed number of committed updates, not timer-paced token delivery. Both
// adapters receive the same snapshots; layout and cross-chunk effects complete
// before each sample ends. This is a work budget, not a frame-rate benchmark.
export const SCENARIOS = ['append-medium', 'append-long', 'code', 'references'];
export const STEPS = 64;
function workload(name) {
  if (!SCENARIOS.includes(name)) throw new Error(`Unknown scenario: ${name}`);
  const count = name === 'append-long' ? 256 : 64;
  let definitions = '';
  const blocks = Array.from({ length: count }, (_, i) => {
    if (name === 'code') return `\`\`\`js\nconst value${i} = ${i};\nconsole.log(value${i});\n\`\`\`\n\n`;
    if (name === 'references') {
      definitions += `[ref${i}]: https://example.com/${i}\n`;
      return `Paragraph ${i}: [reference ${i}][ref${i}].\n\n`;
    }
    return (
      `Paragraph ${i}: **streaming Markdown** retains earlier content while a document grows. ` +
      'The next sentence adds ordinary prose with punctuation and an inline `value` to render.\n\n'
    );
  });
  return { content: blocks.join(''), definitions, count };
}
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
export function install(render) {
  window.__sentinel = async (name, handicapMs = 0) => {
    const { content, definitions, count } = workload(name);
    const container = document.getElementById('root');
    const channel = new MessageChannel();
    const task = () =>
      new Promise((resolve) => {
        channel.port1.onmessage = resolve;
        channel.port2.postMessage(null);
      });
    const samples = [];
    try {
      for (let i = 1; i <= STEPS; i++) {
        const snapshot = content.slice(0, Math.ceil((content.length * i) / STEPS));
        const start = performance.now();
        const until = start + handicapMs;
        while (performance.now() < until) {
          /* known main-thread work for sensitivity checks */
        }
        await render(snapshot, definitions);
        await task();
        // Include layout and pending contribution effects. There is no 16 ms
        // input clock or mandatory rAF wait to hide a slower renderer.
        void container.offsetHeight;
        samples.push(performance.now() - start);
        check(container.textContent.length > 0, `Empty update ${i}`);
      }
      if (name === 'code') {
        check(container.querySelectorAll('pre').length === count, 'Lost code blocks');
        for (let i = 0; i < count; i++) check(container.textContent.includes(`const value${i} = ${i};`), 'Lost code');
      } else {
        check(container.querySelectorAll('p').length === count, 'Lost paragraphs');
        for (let i = 0; i < count; i++) check(container.textContent.includes(`Paragraph ${i}:`), 'Lost prose');
      }
      if (name === 'references') {
        const links = [...container.querySelectorAll('a')];
        check(links.length === count, 'Unresolved cross-chunk links');
        links.forEach((a, i) =>
          check(
            a.textContent === `reference ${i}` && a.getAttribute('href') === `https://example.com/${i}`,
            'Wrong link'
          )
        );
      }
      return {
        workMs: samples.reduce((sum, value) => sum + value, 0),
        maxUpdateMs: Math.max(...samples),
        steps: STEPS,
        bytes: new TextEncoder().encode(content).length,
        nodes: container.querySelectorAll('*').length,
        text: container.textContent,
      };
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  };
}
