import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // FIX: detectSessionInUrl: false — avoids redundant URL parsing on every refresh.
      // FIX: removed flowType: 'pkce' — PKCE requires a one-time code in the URL to
      //      restore a session. On a plain page refresh there is no code, so Supabase
      //      discards the stored session and signs the user out. Use the default
      //      implicit flow for email/password auth (no redirects needed).
      detectSessionInUrl: false,
      storage: window.localStorage,
    },
  }
);