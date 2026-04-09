export const prerender = false;

import type { APIRoute } from 'astro';
import {
  acceptRecommendation, rejectRecommendation,
  updateActionStatus, createManualAction, logInteraction,
} from '../../../lib/db';

/**
 * POST /api/dashboard/update-action
 *
 * Handles two flows:
 * 1. Recommendation decisions: accept (→ creates action_plan) or reject
 * 2. Action plan updates: pending → in_progress → done
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const client = (locals as any).client;
  const user = (locals as any).user;

  if (!client?.id) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { recommendationId, actionId, status, feedback, title, description, impact } = body;
    const userName = (locals as any).user?.name || (locals as any).user?.email || client.name;

    // Flow 0: Create manual action
    if (title && !recommendationId && !actionId) {
      const newId = await createManualAction(client.id, title, description, impact, userName);
      logInteraction(client.id, 'manual_action_created', { actionId: newId, title }, user?.id).catch(() => {});
      return new Response(JSON.stringify({ ok: true, actionId: newId }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Flow 1: Recommendation decision (accept/reject)
    if (recommendationId && (status === 'accepted' || status === 'rejected')) {
      if (status === 'accepted') {
        const newActionId = await acceptRecommendation(recommendationId, client.id, userName);
        logInteraction(client.id, 'recommendation_accepted', {
          recommendationId, actionId: newActionId,
        }, user?.id).catch(() => {});
        return new Response(JSON.stringify({ ok: true, actionId: newActionId }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        await rejectRecommendation(recommendationId, feedback);
        logInteraction(client.id, 'recommendation_rejected', {
          recommendationId, reason: feedback,
        }, user?.id).catch(() => {});
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Flow 2: Action plan status update
    const targetId = actionId || recommendationId;
    if (!targetId || !status) {
      return new Response(JSON.stringify({ error: 'actionId and status required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const validStatuses = ['pending', 'in_progress', 'done'];
    if (!validStatuses.includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid status. Use: pending, in_progress, done' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    await updateActionStatus(targetId, status, feedback);

    logInteraction(client.id, 'action_status_changed', {
      actionId: targetId, newStatus: status, feedback: feedback || null,
    }, user?.id).catch(() => {});

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[update-action] Error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
