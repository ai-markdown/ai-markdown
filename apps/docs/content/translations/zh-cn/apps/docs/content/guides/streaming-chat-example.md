# React 流式聊天示例

本篇端到端集成指南使用 React 与 Next.js 风格的路由处理程序。底层的传输协议与解析原则同样适用于 Vue；在 Vue 中只需将累积的完整文本传入 Vue 组件，无需使用 React 的状态和 Hooks。详见 [Vue 指南](../reference/vue.md#minimal-component)与[包安装配置](getting-started.md)。

流式聊天集成需要确立三项契约：服务端如何封装响应、客户端如何累积文本并处理结束状态、以及 Markdown 渲染器接收什么数据。本示例明确了这三项契约：渲染器接收完整累积的字符串；传输层负责处理文本增量、取消请求、错误捕获与完成信号。

对于常规的助手回复消息，每条消息推荐使用一个 `<AIMarkdown>` 实例。仅在确实需要为各个独立逻辑章节提供独立的 UI 控制或元数据时，才使用多渲染器分块。HTTP 的网络读取边界绝不等于 Markdown 的语法边界：一次网络读取可能正好截断在一个 UTF-8 字符、一个 SSE 事件、一个代码块围栏或一个数学公式的中间。

示例基于 React 19、浏览器原生的 Fetch/Streams API 以及与 Next.js 兼容的 Route Handler。安装 React 适配器，并在导入样式时显式安装 KaTeX：

```sh
pnpm add @ai-markdown/react katex
```

## 你将构建的内容

下方的单条消息完整链路实现了以下功能：

- 接收 JSON 请求体的 `POST /api/chat` 接口。
- `data` 字段为 JSON 的 SSE 事件流，完整保留 Markdown 文本增量中的换行符、反斜杠与空白字符。
- 能够妥善处理网络粘包分包、LF/CRLF/CR 换行符、注释行以及多行 `data:` 的增量事件读取器。
- 显式的 `done` 完成事件；网络连接意外中断将被视作错误而非成功完成。
- 具备取消旧请求、忽略过时更新、在新轮次清空状态并在出错后保留已收到文本的 React Effect。
- 在首个字符出现前展示等待占位、流式光标以及停止生成按钮。

该接口内部使用了一个确定性的 Echo 生成器，无需配置 LLM 账号即可直接运行。你只需将该生成器替换为对应模型供应商的增量迭代器即可。身份鉴权、会话持久化和模型选择由你的业务应用自行管理。

## 传输契约：SSE 内嵌 JSON

每个事件包含一个 JSON 对象。增量事件携带文本片段；结束信号是独立的消息：

```text
data: {"type":"delta","text":"# Answer\n\n"}

data: {"type":"delta","text":"Hello **world**."}

data: {"type":"done"}

```

`text` 内部的换行符会被转义为 JSON 字符串。每个 `data:` 行后面的空行用于终结该 SSE 事件。如果直接在 `data:` 后发送原始 Markdown，当增量包含换行符时就会破坏 SSE 协议帧结构；使用 JSON 编码能将文本内容与传输协议清晰解耦。

```ts
// chat-protocol.ts
export type ChatEvent = { type: 'delta'; text: string } | { type: 'done' } | { type: 'error'; message: string };

export function parseChatEvent(data: string): ChatEvent {
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== 'object') throw new Error('Invalid chat event');
  const event = value as Record<string, unknown>;
  if (event.type === 'delta' && typeof event.text === 'string') {
    return { type: 'delta', text: event.text };
  }
  if (event.type === 'done') return { type: 'done' };
  if (event.type === 'error' && typeof event.message === 'string') {
    return { type: 'error', message: event.message };
  }
  throw new Error('Unknown chat event');
}
```

这里对应用级事件进行了运行时校验，而不是盲目断言 `JSON.parse` 返回了预期结构。下方的读取器负责提取 SSE 数据，`parseChatEvent` 负责验证其业务含义。

## 抵御网络断包的读取器

流式 `TextDecoder` 能够正确处理跨网络读取被截断的 UTF-8 字符。行解析器会等待完整的一行，将跨读取切断的 CRLF 视为单个换行符，且仅在遇到空行时才派发数据事件。连续的多行 `data:` 会使用换行符拼接。

```ts
// read-sse.ts
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let reachedEof = false;

  function* takeLines(final: boolean): Generator<string> {
    while (true) {
      const at = buffer.search(/[\r\n]/);
      if (at < 0) break;
      // A final CR in a network read may be the first half of CRLF.
      if (buffer[at] === '\r' && at === buffer.length - 1 && !final) break;
      const width = buffer[at] === '\r' && buffer[at + 1] === '\n' ? 2 : 1;
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + width);
      if (line === '') {
        if (data.length > 0) yield data.join('\n');
        data = [];
        continue;
      }
      if (line.startsWith(':')) continue; // SSE comment / heartbeat
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      // event/id/retry are intentionally unused by this POST protocol.
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        reachedEof = true;
        buffer += decoder.decode();
        yield* takeLines(true);
        return; // An unterminated event is not dispatched at EOF.
      }
      buffer += decoder.decode(value, { stream: true });
      yield* takeLines(false);
    }
  } finally {
    // Leaving after `done` or an application error stops the body too.
    if (!reachedEof) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
```

该读取器专为文档所列的 POST 协议设计，并非通用的带断线重连的 EventSource 客户端。它不解析 event ID 或重试指示，也不发起重连。如果你使用了现成的传输库，请保留其既定的事件分帧和重连机制，不要在同一数据流上叠加运行两套解析器。

## 方案 A：单 `<AIMarkdown>` 持续累积内容

当 `id` 或 `prompt` 改变时，组件会启动新请求。Effect 内部的 `active` 标记能防止旧请求将内容写入新消息中。清理函数会中止请求，这也确保了 React 19 严格模式（Strict Mode）在开发环境下重放 Effect 时的安全性。

```tsx
// ChatMessage.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import AIMarkdown, { AIMarkdownStreamingCursor } from '@ai-markdown/react';
import { readSseData } from './read-sse';
import { parseChatEvent } from './chat-protocol';

interface ChatMessageProps {
  id: string;
  prompt: string;
}

type Status = 'waiting' | 'streaming' | 'done' | 'stopped' | 'error';

export function ChatMessage({ id, prompt }: ChatMessageProps) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<Status>('waiting');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    let active = true;
    setContent('');
    setError(null);
    setStatus('waiting');

    async function run() {
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
          body: JSON.stringify({ prompt }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Chat request failed (${response.status})`);
        if (!response.body) throw new Error('Chat response has no body');
        if (!response.headers.get('content-type')?.includes('text/event-stream')) {
          throw new Error('Expected an SSE response');
        }

        for await (const data of readSseData(response.body)) {
          if (!active || controller.signal.aborted) return;
          const event = parseChatEvent(data);
          if (event.type === 'error') throw new Error(event.message);
          if (event.type === 'done') {
            setStatus('done');
            return;
          }
          setContent((previous) => previous + event.text);
          setStatus('streaming');
        }
        throw new Error('Connection ended before completion');
      } catch (cause) {
        if (!active) return;
        if (controller.signal.aborted) {
          setStatus('stopped');
          return;
        }
        setError(cause instanceof Error ? cause.message : 'Chat request failed');
        setStatus('error');
      }
    }

    void run();
    return () => {
      active = false;
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [id, prompt]);

  const pending = status === 'waiting' || status === 'streaming';
  return (
    <section className="chat-message" aria-label="Assistant message" aria-busy={pending}>
      {pending && content === '' && <p role="status">Waiting for a response…</p>}
      <AIMarkdown content={content} documentId={id} streaming={pending} streamingCursor={AIMarkdownStreamingCursor} />
      {pending && (
        <button type="button" onClick={() => abortRef.current?.abort()}>
          Stop
        </button>
      )}
      {status === 'stopped' && <p role="status">Response stopped.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
```

在调用处请使用稳定的组件 key。对于全新的独立请求或重新生成轮次，传入新的请求 key 可以防止上一轮的状态在 Effect 重置之前闪现：

```tsx
<ChatMessage key={requestId} id={messageId} prompt={prompt} />
```

中止客户端请求并不代表服务端模型提供商已经停止计费计算。当供应商 API 支持取消时，请将服务端的 request signal 传递给模型提供商。严格模式可能在 Effect 重放期间启动并中止请求；执行持久化副作用的后端应具备自己的请求标识与幂等策略。

### 为什么该方案效果良好

React 适配器接收的是累积的完整内容，因此未修改的前缀能够享受增量解析和块级缓存。能否命中仍然取决于源文本语法：未闭合的语法结构或未解析的引用可能会导致活动尾部较长。该示例并不保证每 Token 耗费恒定计算量。

`streaming` 状态在等待输入或接收数据期间持续为 `true`，在完成、停止或出错时变为 `false`。内置光标在缺少合适文本锚点时会主动隐去，因此显式的等待段落覆盖了首个 Token 产生前的状态。`aria-busy` 传达了消息的活动状态，避免将每个 Token 都变成屏幕阅读器的动态播报。

`documentId` 为脚注和允许的 HTML ID 提供了稳定的命名空间。单一实例不需要包装跨片段注册表；该消息内部的引用直接在同一份解析树中就能被正确定位。

## Next.js App Router 细节

请将交互式请求状态和包含函数的渲染器配置放置在客户端组件（Client Component）中。React 适配器发布的入口保留了其客户端边界，但应用程序自身的 Hooks 和回调函数仍需要放置在客户端模块中。切勿尝试跨服务端与客户端的可序列化属性边界传递组件函数、预处理器或 URL 校验回调；请在客户端封装层中定义它们。

### 在 `layout.tsx` 中导入 CSS

根布局是确立样式表加载顺序最清晰的位置：

```tsx
// app/layout.tsx
import type { ReactNode } from 'react';
import 'katex/dist/katex.min.css';
import '@ai-markdown/react/typography/default.css';
import './globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

这是示例中的推荐组织方式，并不意味着禁止在组件层导入样式。如果使用 Mantine 集成，还需要配置对应的 Provider/Adapter 并引入 [Mantine 参考文档](../reference/react-mantine.md#css-dependencies)中列出的三份样式表。

### 流式 API 路由

该路由使用了 Web 标准的 `Request`、`Response` 与 `ReadableStream` 类型。每次 pull 仅发射一个事件，使生产端按流式使用速率推进，而不是一次性将整个回复入队：

```ts
// app/api/chat/route.ts
export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: 'Expected JSON' }, { status: 400 });
  }
  const prompt = input && typeof input === 'object' && 'prompt' in input ? input.prompt : undefined;
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return Response.json({ error: 'A prompt is required' }, { status: 400 });
  }

  async function* generate() {
    const answer = `# Echo\n\n${prompt}\n`;
    // Replace this iterator with the provider's text-delta iterator.
    for (const character of answer) {
      if (request.signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (request.signal.aborted) return;
      yield character;
    }
  }

  const iterator = generate();
  const encoder = new TextEncoder();
  let cancelled = false;
  const encode = (event: object) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (cancelled) return;
        if (request.signal.aborted) {
          controller.close();
          return;
        }
        if (next.done) {
          controller.enqueue(encode({ type: 'done' }));
          controller.close();
        } else {
          controller.enqueue(encode({ type: 'delta', text: next.value }));
        }
      } catch {
        if (!cancelled) {
          controller.enqueue(encode({ type: 'error', message: 'Generation failed' }));
          controller.close();
        }
      }
    },
    async cancel() {
      cancelled = true;
      await iterator.return(undefined);
    },
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
```

这里的缓冲响应头仅是对兼容代理服务器的提示，并非端到端的传输保障。如果数据块在部署后依然大团爆发到达，请检查网络链路上的中间代理。平滑流式输出可以调整视觉展示节奏，但无法在网络真正送达之前凭空生成内容。

## 方案 B：使用 `<AIMarkdownDocuments>` 分块渲染

独立渲染器适用于能够独立解析且具有各自元数据、控制按钮或生命周期的逻辑章节。服务端必须明确暴露这些逻辑边界，不能将每一次底层的网络读取直接当作独立的 Markdown 文档片段。

推荐的应用层事件格式为 `{ type: 'chunk', index, text, done }`，其中 `text` 属于该逻辑章节的增量，`done` 标记该章节结束。在更新状态之前请先进行校验。保持服务端索引稳定；如果分块乱序到达，请显式排序：

```tsx
interface Chunk {
  index: number;
  text: string;
  done: boolean;
}
interface ChunkEvent {
  type: 'chunk';
  index: number;
  text: string;
  done: boolean;
}

function applyChunk(previous: Chunk[], event: ChunkEvent): Chunk[] {
  if (!Number.isSafeInteger(event.index) || event.index < 0) throw new Error('Invalid chunk index');
  const existing = previous.find((chunk) => chunk.index === event.index);
  if (existing?.done) throw new Error('Received content for a completed chunk');
  const next = {
    index: event.index,
    text: (existing?.text ?? '') + event.text,
    done: event.done,
  };
  return [...previous.filter((chunk) => chunk.index !== event.index), next].sort((a, b) => a.index - b.index);
}
```

请求取消、HTTP 校验、SSE 读取器以及整体的完成/错误处理与方案 A 保持一致。全局的 `done` 事件应当在所有逻辑章节均传输完毕后方才到达。在出错或取消时，请清除状态中的活跃标记，避免任何分块永久处于生成中状态。

```tsx
import AIMarkdown, { AIMarkdownDocuments, AIMarkdownStreamingCursor } from '@ai-markdown/react';

function ChunkedMessage({ id, chunks, pending }: { id: string; chunks: Chunk[]; pending: boolean }) {
  return (
    <AIMarkdownDocuments>
      {chunks.map((chunk) => (
        <AIMarkdown
          key={chunk.index}
          documentId={id}
          documentIndex={chunk.index}
          content={chunk.text}
          streaming={pending && !chunk.done}
          streamingCursor={AIMarkdownStreamingCursor}
        />
      ))}
    </AIMarkdownDocuments>
  );
}
```

每个活跃的分块只要拥有合法的文本锚点，就会获得一个光标。该示例允许同时存在多个活跃分块；只有当服务端严格串行推送时，才能保证仅有最后一个分块在流式生成。如果希望在并发推送的章节间实现视觉上的单打字机效果，请使用文档平滑轮流呈现。

跨片段协调负责共享脚注编号与引用定义。它**不会**拼接跨组件被切断的段落、延续列表序号，也不会闭合在另一个实例中打开的代码围栏。请保持 `blockMemo` 开启；无记忆路径会以独立语义渲染每个分块。`documentIndex` 负责对已挂载的分块注册表贡献进行排序，但无法保留已卸载分块的定义。在引入虚拟化之前，请阅读[跨片段协调指南](cross-chunk-coordination.md)。

## 在不修改协议的前提下增加平滑输出

将原始累积的源文本传给平滑外壳组件，或使用 Hook 自定义封装。其返回的 `streaming` 描述的是视觉呈现状态，该状态在数据源结束之后仍可能持续保持活跃：

```tsx
import AIMarkdown, { useSmoothStream, AIMarkdownStreamingCursor } from '@ai-markdown/react';

function SmoothMessage({ content, pending }: { content: string; pending: boolean }) {
  const { flush, ...visible } = useSmoothStream({ content, streaming: pending, pacing: 'balanced' });
  return (
    <div aria-busy={visible.streaming}>
      <AIMarkdown {...visible} streamingCursor={AIMarkdownStreamingCursor} />
      {visible.streaming && (
        <button type="button" onClick={flush}>
          Show available text
        </button>
      )}
    </div>
  );
}
```

若新到达的内容需要播放打字动画，请以空内容挂载组件。非空内容挂载会瞬间完整呈现传入的文本，以支持 SSR 水合与列表滚回重入。在协调队列中，等待输入期间请使用 `smoothWaiting` 挂载空占位组件；否则未流式的空分块会被判定为已完成。关于排空回调、结束判定、字素边界以及减少动画偏好支持，请参阅[平滑流式输出指南](smooth-streaming.md)。

## 方案 A 与方案 B 的权衡选择

| 业务诉求                 | 累积消息（方案 A）         | 逻辑分块（方案 B）                 |
| ------------------------ | -------------------------- | ---------------------------------- |
| 最简单的状态与请求管理   | 单个字符串与单一渲染器     | 管理各个章节的状态与顺序           |
| 跨传输增量的复杂语法     | 解析前先累积完字符串       | 必须在各个独立章节内部完成累积     |
| 贯穿整条消息的引用解析   | 单一解析器直接解析全部内容 | 需要注册表容器并共享文档 ID        |
| 各章节独立的控制或元数据 | 需要在应用层建立对应结构   | 天然契合的组件边界                 |
| 列表虚拟滚动             | 保持消息始终挂载           | 需要处理分块卸载导致的定义贡献丢失 |
| 平滑视觉展开             | 单个 Hook 或外壳即可       | 可选用按挂载顺序的轮流呈现机制     |

## 集成验证核对清单

在开发测试中，请验证以下边界情况：包含真实换行符的响应、跨字节读取被切断的中文字符或 Emoji 表情、跨读取切断的 SSE 边界、以及增量后紧接着到达的 `done` 信号。最终渲染的文本必须与所有增量拼接出的结果完全一致。

同时应当测试 HTTP 异常状态码、畸变 JSON、未收到 `done` 的连接意外中断、用户主动取消、快速切换 Prompt 发起新请求、以及空内容正常完成等场景。旧请求不能向新轮次追加内容；任何终态都必须将 `streaming` 清除为 `false`。对于多片段模式，还需验证后置定义、乱序到达、重复完成信号以及从未接收到任何文本的空章节。

保持组件和策略函数引用稳定，切勿在 Markdown 源码末尾强行拼接光标符号。如果高频更新导致页面卡顿，在应用层建立有界的增量合并缓冲是延迟与性能之间合理的工程权衡；请测量性能并确保在结束时 flush 最终内容。块级缓存能够显著减少重复工作，但无法彻底消除每次内容更新带来的开销。
