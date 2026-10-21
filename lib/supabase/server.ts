import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export class SupabaseConfigError extends Error {
  code = "supabase_not_configured"

  constructor(message: string) {
    super(message)
    this.name = "SupabaseConfigError"
  }
}

export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new SupabaseConfigError(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    )
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
