import { createClient } from '@supabase/supabase-js'

// Do NOT hardcode credentials here. Fill in .env.local before running.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || supabaseUrl === 'your_supabase_url_here') {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL — fill in .env.local first')
}
if (!supabaseAnonKey || supabaseAnonKey === 'your_supabase_anon_key_here') {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY — fill in .env.local first')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ── Types matching the Supabase schema ──────────────────────────────────────

export type InsType =
  | 'motor'
  | 'health'
  | 'life'
  | 'property'
  | 'travel'
  | 'personal_accident'
  | 'marine'
  | 'other'
export type Status = 'waiting' | 'called' | 'served'

export interface QueueRow {
  id: string
  token: string
  name: string
  phone: string
  purpose: string   // free-text — customer's own description of their visit
  ins_type: InsType
  // priority: 1 for renewal, 2 for new policy.
  // Renewals come first because a lapsed policy means the customer loses
  // coverage — that is genuinely more time-sensitive than a new purchase.
  priority: number
  status: Status
  escalated: boolean
  arrived_at: string
  served_at: string | null
}
