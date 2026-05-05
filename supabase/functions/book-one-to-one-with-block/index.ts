import { corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { notify } from '../_shared/notify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const user = await getUserFromToken(authHeader);
  if (!user) return errorResponse('Unauthorized', 401);

  const { one_to_one_id } = await req.json() as { one_to_one_id: string };
  if (!one_to_one_id) return errorResponse('one_to_one_id is required.', 400);

  const adminClient = createAdminClient();

  const { error } = await adminClient.rpc('book_one_to_one_with_block', {
    p_one_to_one_id: one_to_one_id,
  });
  if (error) {
    const code = error.code === '42501' ? 403 : 400;
    return errorResponse(error.message, code);
  }

  // Notify the 1-to-1 creator that someone booked their session.
  const { data: oto } = await adminClient
    .from('one_to_ones')
    .select('title, session_date, creator_id')
    .eq('id', one_to_one_id)
    .single();

  if (oto?.creator_id && oto.creator_id !== user.id) {
    const { data: studentProfile } = await adminClient
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    await notify({
      adminClient,
      userId: oto.creator_id,
      type: 'one_to_one_booked',
      title: '1-to-1 booked',
      body: `${studentProfile?.full_name ?? 'A student'} booked "${oto.title}" on ${oto.session_date} using a block.`,
      data: { oneToOneId: one_to_one_id },
    });
  }

  return jsonResponse({ ok: true });
});
