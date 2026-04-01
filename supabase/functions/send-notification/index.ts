import { corsHeaders, corsResponse, jsonResponse } from '../_shared/cors.ts';

interface PushPayload {
  pushToken: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  const payload = await req.json() as PushPayload;

  if (!payload.pushToken || !payload.title || !payload.body) {
    return jsonResponse({ error: 'Missing required fields' }, 400);
  }

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: payload.pushToken,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      sound: payload.sound ?? 'default',
      priority: 'high',
      channelId: 'default',
    }),
  });

  const result = await response.json();

  if (result.data?.status === 'error') {
    console.error('Push notification error:', result.data);
  }

  return jsonResponse({ ok: true });
});
