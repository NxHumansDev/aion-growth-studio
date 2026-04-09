export const prerender = false;

import type { APIRoute } from 'astro';
import { ADVISOR_CHAT_PROMPT } from '../../../lib/ai/system-prompt';
import { buildAdvisorContext } from '../../../lib/advisor/context';
import {
  createThread, saveMessage, getThreadMessages, touchThread, updateThreadTitle,
  checkBudget, recordUsage, saveLearnings,
} from '../../../lib/advisor/db';
import { logRecommendation } from '../../../lib/db';

const ANTHROPIC_KEY = import.meta.env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

// Cost per 1K tokens (USD cents) — Sonnet 4.6
const INPUT_COST_PER_1K = 0.3;   // $0.003/1K = 0.3 cents
const OUTPUT_COST_PER_1K = 1.5;  // $0.015/1K = 1.5 cents

function estimateCostCents(inputTokens: number, outputTokens: number): number {
  return Math.ceil((inputTokens / 1000) * INPUT_COST_PER_1K + (outputTokens / 1000) * OUTPUT_COST_PER_1K);
}

/**
 * POST /api/advisor/chat
 *
 * Streaming chat endpoint. Accepts { message, threadId? }.
 * Creates thread if needed, checks budget, streams Claude response,
 * extracts actions + learnings, records usage.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;
  if (!client?.id) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!ANTHROPIC_KEY) {
    return new Response(JSON.stringify({ error: 'Anthropic API key not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await request.json();
  const userMessage: string = body.message?.trim();
  let threadId: string | undefined = body.threadId;

  if (!userMessage) {
    return new Response(JSON.stringify({ error: 'Message is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Budget check ─────────────────────────────────────────────
  const budget = await checkBudget(client.id);
  if (!budget.allowed) {
    return new Response(JSON.stringify({
      error: 'budget_exceeded',
      message: budget.reason,
      renewsAt: budget.renewsAt,
    }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  }

  // ── Thread management ────────────────────────────────────────
  if (!threadId) {
    threadId = await createThread(client.id, userMessage.slice(0, 60));
  }

  // Save user message
  await saveMessage(threadId, client.id, 'user', userMessage);
  await touchThread(threadId);

  // ── Build context + messages ─────────────────────────────────
  const [context, threadHistory] = await Promise.all([
    buildAdvisorContext(client.id, client.domain),
    getThreadMessages(threadId),
  ]);

  // Build Claude messages: system context + thread history
  const claudeMessages = threadHistory.map(m => ({
    role: m.role === 'advisor' ? 'assistant' as const : 'user' as const,
    content: m.content,
  }));

  // ── Stream Claude response ───────────────────────────────────
  const claudeBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    stream: true,
    system: ADVISOR_CHAT_PROMPT + '\n\n---\n\n## CONTEXTO DEL CLIENTE\n\n' + context,
    messages: claudeMessages,
  };

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(claudeBody),
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.text().catch(() => '');
    console.error(`[advisor] Claude API error ${claudeRes.status}:`, err.slice(0, 200));
    return new Response(JSON.stringify({ error: 'AI service unavailable' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create a transform stream that:
  // 1. Forwards SSE chunks to the client
  // 2. Accumulates the full response text
  // 3. After stream ends: save message, extract actions/learnings, record usage
  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = claudeRes.body!.getReader();

      try {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);

              if (event.type === 'content_block_delta' && event.delta?.text) {
                fullText += event.delta.text;
                // Forward text chunk to client
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`));
              }

              if (event.type === 'message_delta' && event.usage) {
                outputTokens = event.usage.output_tokens || 0;
              }

              if (event.type === 'message_start' && event.message?.usage) {
                inputTokens = event.message.usage.input_tokens || 0;
              }
            } catch { /* skip malformed SSE */ }
          }
        }
      } catch (err) {
        console.error('[advisor] Stream error:', (err as Error).message);
      }

      // ── Post-stream processing (non-blocking) ─────────────
      const costCents = estimateCostCents(inputTokens, outputTokens);

      // Send metadata as final SSE event
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        done: true,
        threadId,
        inputTokens,
        outputTokens,
        costCents,
      })}\n\n`));

      controller.close();

      // Fire-and-forget: save response + extract actions + record usage
      processResponse(threadId!, client.id, fullText, inputTokens, outputTokens, costCents)
        .catch(err => console.error('[advisor] Post-process error:', err.message));
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};

// ── Post-stream processing ─────────────────────────────────────

async function processResponse(
  threadId: string,
  clientId: string,
  fullText: string,
  inputTokens: number,
  outputTokens: number,
  costCents: number,
) {
  // 1. Extract actions and learnings from response
  const { cleanText, actions, learnings } = parseAdvisorResponse(fullText);

  // 2. Create recommendations for extracted actions
  const actionIds: string[] = [];
  for (const action of actions) {
    try {
      const id = await logRecommendation({
        client_id: clientId,
        source: 'advisor',
        title: action.title,
        description: action.description,
        impact: action.impact || 'medium',
        data: action.expected_kpis?.length ? { expected_kpis: action.expected_kpis } : undefined,
      });
      if (id) actionIds.push(id);
    } catch (err) {
      console.error('[advisor] Failed to create action:', (err as Error).message);
    }
  }

  // 3. Save learnings
  if (learnings.length) {
    await saveLearnings(clientId, learnings).catch(() => {});
  }

  // 4. Save advisor message
  await saveMessage(threadId, clientId, 'advisor', cleanText, {
    tokensInput: inputTokens,
    tokensOutput: outputTokens,
    actionsCreated: actionIds,
  });

  // 5. Record usage
  await recordUsage(clientId, costCents);

  // 6. Auto-title thread if first response
  if (cleanText.length > 20) {
    // Use first sentence as title (max 60 chars)
    const firstSentence = cleanText.split(/[.!?\n]/)[0]?.trim().slice(0, 60);
    if (firstSentence) {
      await updateThreadTitle(threadId, firstSentence).catch(() => {});
    }
  }

  console.log(`[advisor] ${clientId}: ${inputTokens}+${outputTokens} tokens, €${(costCents / 100).toFixed(2)}, ${actions.length} actions, ${learnings.length} learnings`);
}

// ── Response parser ────────────────────────────────────────────

interface ExpectedKPI {
  key: string;
  label: string;
  direction: 'up' | 'down';
}

interface ParsedAction {
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  expected_kpis?: ExpectedKPI[];
}

interface ParsedLearning {
  type: string;
  content: string;
}

function parseAdvisorResponse(text: string): {
  cleanText: string;
  actions: ParsedAction[];
  learnings: ParsedLearning[];
} {
  let cleanText = text;
  const actions: ParsedAction[] = [];
  const learnings: ParsedLearning[] = [];

  // Extract ```actions blocks
  const actionsMatch = text.match(/```actions\s*\n([\s\S]*?)```/);
  if (actionsMatch) {
    cleanText = cleanText.replace(actionsMatch[0], '').trim();
    try {
      const parsed = JSON.parse(actionsMatch[1]);
      if (Array.isArray(parsed)) {
        for (const a of parsed) {
          if (a.title && a.description) {
            actions.push({
              title: a.title,
              description: a.description,
              impact: ['high', 'medium', 'low'].includes(a.impact) ? a.impact : 'medium',
              expected_kpis: Array.isArray(a.expected_kpis) ? a.expected_kpis.filter(
                (k: any) => k.key && k.label
              ) : undefined,
            });
          }
        }
      }
    } catch { /* malformed JSON */ }
  }

  // Extract ```learnings blocks
  const learningsMatch = text.match(/```learnings\s*\n([\s\S]*?)```/);
  if (learningsMatch) {
    cleanText = cleanText.replace(learningsMatch[0], '').trim();
    try {
      const parsed = JSON.parse(learningsMatch[1]);
      if (Array.isArray(parsed)) {
        for (const l of parsed) {
          if (l.content) {
            learnings.push({
              type: l.type || 'insight',
              content: l.content,
            });
          }
        }
      }
    } catch { /* malformed JSON */ }
  }

  return { cleanText, actions, learnings };
}
