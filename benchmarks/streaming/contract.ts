export interface StreamChunk {
  content: string;
  streaming: boolean;
}
export interface StreamingProbe {
  update(chunks: StreamChunk[]): Promise<void>;
}
declare global {
  interface Window {
    streamingProbe: StreamingProbe;
  }
}

/** A real input target kept outside the measured Markdown subtree. */
export function installInteractionProbe() {
  const button = document.createElement('button');
  button.textContent = 'Respond during streaming';
  button.id = 'interaction';
  button.style.cssText = 'position:fixed;top:4px;right:4px;z-index:1000';
  button.addEventListener('click', (event) => {
    button.dataset.streamingAtClick = String(!!document.querySelector('[data-active="true"]'));
    button.dataset.clicks = String(Number(button.dataset.clicks ?? 0) + 1);
    requestAnimationFrame(() => {
      button.dataset.latency = String(performance.now() - event.timeStamp);
    });
  });
  document.body.append(button);
}
