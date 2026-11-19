import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const ownerEmail = process.env.OWNER_EMAIL || '';

if (!supabaseUrl || !supabaseAnonKey || !ownerEmail) {
  throw new Error('Missing owner authentication configuration.');
}

export async function getAuthenticatedOwner(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const accessToken = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : '';

  if (!accessToken) {
    return { owner: null, error: 'Sign in required.' } as const;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    return { owner: null, error: 'Invalid or expired session.' } as const;
  }

  if ((data.user.email || '').toLowerCase() !== ownerEmail.toLowerCase()) {
    return { owner: null, error: 'Owner access required.' } as const;
  }

  return { owner: data.user, error: null } as const;
}
