import type { APIRoute } from 'astro';
import { getUserFromCookie } from '../../lib/auth';
import { createDiaryAgent } from '../../lib/agent/diaryAgent';

export const maxDuration = 60;

type StreamEvent =
  | { type: 'start' }
  | { type: 'token'; node: string; text: string }
  | { type: 'node'; node: string; title: string; detail?: string }
  | { type: 'tool_call'; node: string; name: string; args: unknown }
  | { type: 'tool_result'; node: string; name: string; detail: string; raw?: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

function messageText(message: any): string {
  const content = message?.content ?? message?.kwargs?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .join('');
  }
  return '';
}

function tokenText(token: any): string {
  if (Array.isArray(token?.contentBlocks)) {
    return token.contentBlocks
      .map((block: any) => {
        if (block?.type === 'text' && typeof block.text === 'string') return block.text;
        return '';
      })
      .join('');
  }
  return messageText(token);
}

function toolCalls(message: any): Array<{ name: string; args: unknown }> {
  const calls = message?.tool_calls ?? message?.toolCalls ?? message?.kwargs?.tool_calls ?? [];
  if (!Array.isArray(calls)) return [];
  return calls.map((call) => ({
    name: String(call?.name ?? 'unknown_tool'),
    args: call?.args ?? {},
  }));
}

function messageKind(message: any): string {
  const type =
    message?._getType?.() ??
    message?.type ??
    message?.kwargs?.type ??
    message?.lc_kwargs?.type ??
    message?.role ??
    message?.constructor?.name ??
    '';
  return String(type).toLowerCase();
}

function isToolNode(node: string): boolean {
  return node.toLowerCase().includes('tool');
}

function isToolMessage(message: any): boolean {
  const kind = messageKind(message);
  return kind.includes('tool') || typeof message?.tool_call_id === 'string' || typeof message?.kwargs?.tool_call_id === 'string';
}

function summarizeToolResult(message: any): { name: string; detail: string; raw: string } {
  const name = String(message?.name ?? message?.kwargs?.name ?? 'tool');
  const content = messageText(message);

  try {
    const data = JSON.parse(content);
    if (data?.ok === false) {
      return { name, detail: String(data.error ?? '工具调用失败'), raw: JSON.stringify(data, null, 2) };
    }
    if (data?.tool === 'upsert_my_today_diary' && data?.date) {
      const actionText = data.action === 'created' ? '新建' : '更新';
      return {
        name,
        detail: `${data.date} 日记已${actionText}并同步`,
        raw: JSON.stringify(data, null, 2),
      };
    }
    if (data?.range && typeof data.count === 'number') {
      const owner = data?.target_user?.username ? `${data.target_user.username}：` : '';
      return {
        name,
        detail: `${owner}${data.range.start_date} 至 ${data.range.end_date}，查询到 ${data.count} 篇日记`,
        raw: JSON.stringify(data, null, 2),
      };
    }
  } catch {
    // Fall through to a short generic preview.
  }

  const compact = content.replace(/\s+/g, ' ').trim();
  return {
    name,
    detail: compact.length > 120 ? `${compact.slice(0, 120)}...` : compact || '工具已返回结果',
    raw: content,
  };
}

function updateEvents(chunk: any): { events: StreamEvent[]; finalText: string } {
  const events: StreamEvent[] = [];
  let finalText = '';

  for (const [node, data] of Object.entries(chunk ?? {})) {
    const messages = Array.isArray((data as any)?.messages) ? (data as any).messages : [];
    const last = messages[messages.length - 1];

    if (isToolNode(node) || messages.some(isToolMessage)) {
      messages.forEach((message: any) => {
        const result = summarizeToolResult(message);
        events.push({ type: 'tool_result', node, name: result.name, detail: result.detail, raw: result.raw });
      });
      continue;
    }

    const calls = toolCalls(last);
    if (calls.length > 0) {
      events.push({ type: 'node', node, title: '模型选择工具', detail: calls.map((call) => call.name).join(', ') });
      calls.forEach((call) => events.push({ type: 'tool_call', node, name: call.name, args: call.args }));
      continue;
    }

    const text = messageText(last).trim();
    if (text) {
      finalText = text;
      events.push({ type: 'node', node, title: '模型生成回答' });
    } else {
      events.push({ type: 'node', node, title: `${node} 节点完成` });
    }
  }

  return { events, finalText };
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const user = getUserFromCookie(cookies);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let message = '';
  try {
    const payload = await request.json();
    message = String(payload?.message ?? '').trim();
  } catch {
    return new Response(JSON.stringify({ error: '请求体无效' }), { status: 400 });
  }

  if (!message) {
    return new Response(JSON.stringify({ error: '消息不能为空' }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      send({ type: 'start' });

      try {
        const agent = createDiaryAgent(user.id);
        let fallbackFinalText = '';
        let streamedText = '';
        const agentStream = await agent.stream(
          { messages: [{ role: 'user', content: message }] },
          { streamMode: ['updates', 'messages'] },
        );

        for await (const [streamMode, chunk] of agentStream as any) {
          if (streamMode === 'updates') {
            const { events, finalText } = updateEvents(chunk);
            if (finalText) fallbackFinalText = finalText;
            events.forEach(send);
            continue;
          }

          if (streamMode === 'messages') {
            const [token, metadata] = chunk as [any, any];
            const node = String(metadata?.langgraph_node ?? 'model');
            if (isToolNode(node) || isToolMessage(token)) continue;

            const text = tokenText(token);
            if (!text) continue;
            streamedText += text;
            send({ type: 'token', node, text });
          }
        }

        if (!streamedText && fallbackFinalText) {
          send({ type: 'final', text: fallbackFinalText });
        }
        send({ type: 'done' });
        controller.close();
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : 'Agent 调用失败',
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
};
