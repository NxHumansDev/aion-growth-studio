export const prerender = false;

import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const domain = url.searchParams.get('domain') || 'google.com';

  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    return new Response(JSON.stringify({ error: 'DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD not set in env' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = Buffer.from(`${login}:${password}`).toString('base64');

  try {
    const res = await fetch('https://api.dataforseo.com/v3/domain_analytics/overview/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify([{ target: domain }]),
    });

    const data = await res.json();
    const task = data?.tasks?.[0];
    const result = task?.result?.[0];

    return new Response(JSON.stringify({
      http_status: res.status,
      task_status_code: task?.status_code,
      task_status_message: task?.status_message,
      cost: task?.cost,
      domain_rank: result?.domain_rank,
      organic_etv: result?.metrics?.organic?.etv,
      keywords_count: result?.metrics?.organic?.count,
      raw_task_summary: {
        id: task?.id,
        status_code: task?.status_code,
        status_message: task?.status_message,
        time: task?.time,
        cost: task?.cost,
        result_count: task?.result_count,
      },
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
