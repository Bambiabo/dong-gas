import { createClient } from '@supabase/supabase-js';

export async function getAuthenticatedOwner(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!url || !key || !email) {
    return { owner: null, error: 'Owner authentication is not configured.' } as const;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '');
  if (!match) return { owner: null, error: 'Sign in required.' } as const;
  const token = match[1];
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user || !data.user.email_confirmed_at || data.user.email?.toLowerCase() !== email) {
      return { owner: null, error: 'Owner access required.' } as const;
    }
    const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel(token);
    if (assurance.error || assurance.data?.currentLevel !== 'aal2') {
      return { owner: null, error: 'Authenticator verification required.' } as const;
    }
    return { owner: data.user, error: null } as const;
  } catch {
    return { owner: null, error: 'Unable to verify owner session.' } as const;
  }
}
