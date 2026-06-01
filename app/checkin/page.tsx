'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { InsType } from '@/lib/supabase'

type FormState = {
  name: string
  phone: string
  purposeText: string   // free-text description of why they're here
  visitKind: 'renewal' | 'new' | 'refund' | 'enquiry' | 'other_visit' | ''
  ins_type: InsType | ''
  ins_type_other: string // filled when ins_type === 'other'
}

type Confirmation = {
  token: string
  name: string
  purposeText: string
  isRenewal: boolean
  ins_label: string  // resolved display label including "Other" free text
  ahead: number
}

const INS_LABELS: Record<InsType, string> = {
  motor: 'Motor Insurance',
  health: 'Health Insurance',
  life: 'Life Insurance',
  property: 'Property / Fire Insurance',
  travel: 'Travel Insurance',
  personal_accident: 'Personal Accident Insurance',
  marine: 'Marine / Cargo Insurance',
  other: 'Other',
}

export default function CheckinPage() {
  const [form, setForm] = useState<FormState>({
    name: '', phone: '', purposeText: '', visitKind: '', ins_type: '', ins_type_other: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [noToken, setNoToken] = useState(false)
  const [countdown, setCountdown] = useState(30)

  // After check-in, count down 30 s then reset for the next customer.
  useEffect(() => {
    if (!confirmation) return
    setCountdown(30)
    const interval = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          clearInterval(interval)
          setConfirmation(null)
          setForm({ name: '', phone: '', purposeText: '', visitKind: '', ins_type: '', ins_type_other: '' })
          return 30
        }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [confirmation])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.visitKind) {
      setError('Please select a visit type.')
      return
    }

    // No token needed — just show the redirect card, nothing goes to the DB.
    if (form.visitKind === 'enquiry' || form.visitKind === 'other_visit') {
      setNoToken(true)
      return
    }

    if (!form.purposeText.trim()) {
      setError('Please describe your visit purpose.')
      return
    }
    if (!form.ins_type) {
      setError('Please select an insurance type.')
      return
    }
    if (form.ins_type === 'other' && !form.ins_type_other.trim()) {
      setError('Please specify your insurance type.')
      return
    }

    const phoneRegex = /^\d{10}$/
    if (!phoneRegex.test(form.phone)) {
      setError('Please enter a valid 10-digit mobile number.')
      return
    }

    setSubmitting(true)

    try {
      // Refunds use their own counter inside insertQueueRow — pass 0 as a
      // placeholder since the value won't be used for RF tokens.
      if (form.visitKind === 'refund') {
        await insertQueueRow(0)
        return
      }

      // ── Atomically increment the policy token counter (id=1) ────────────
      const { data: counterData, error: counterError } = await supabase
        .rpc('increment_token_counter')

      if (counterError || !counterData) {
        const { data: cur, error: fetchErr } = await supabase
          .from('token_counter').select('last_number').eq('id', 1).single()
        if (fetchErr || !cur) throw new Error('Could not fetch token counter.')
        const newNumber: number = cur.last_number + 1
        const { error: updateErr } = await supabase
          .from('token_counter').update({ last_number: newNumber }).eq('id', 1)
        if (updateErr) throw new Error('Could not update token counter.')
        await insertQueueRow(newNumber)
        return
      }

      await insertQueueRow(counterData as number)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  async function insertQueueRow(tokenNumber: number) {
    const ins_type = form.ins_type as InsType
    const ins_type_label = ins_type === 'other'
      ? form.ins_type_other.trim()
      : INS_LABELS[ins_type]
    const purpose = form.purposeText.trim()

    // ── Token prefix + priority by visit kind ────────────────────────────
    // R  = Renewal   (priority 1 — lapsing policy, most urgent)
    // N  = New policy (priority 2 — no existing coverage at risk)
    // RF = Refund     (priority 3 — uses its own separate counter)
    let token: string
    let priority: number

    if (form.visitKind === 'refund') {
      // Refund customers have their own counter (token_counter id=2) so the
      // RF series is independent of the R/N series used for policies.
      const { data: refundCounter, error: rcErr } = await supabase
        .rpc('increment_refund_counter')

      let refundNumber: number
      if (rcErr || !refundCounter) {
        // Fallback manual increment
        const { data: cur, error: fetchErr } = await supabase
          .from('token_counter').select('last_number').eq('id', 2).single()
        if (fetchErr || !cur) throw new Error('Could not fetch refund counter.')
        refundNumber = cur.last_number + 1
        const { error: updateErr } = await supabase
          .from('token_counter').update({ last_number: refundNumber }).eq('id', 2)
        if (updateErr) throw new Error('Could not update refund counter.')
      } else {
        refundNumber = refundCounter as number
      }

      token = `RF${refundNumber}`
      priority = 3
    } else {
      token = `${form.visitKind === 'renewal' ? 'R' : 'N'}${tokenNumber}`
      priority = form.visitKind === 'renewal' ? 1 : 2
    }

    const { error: insertError } = await supabase.from('queue').insert({
      token,
      name: form.name.trim(),
      phone: form.phone.trim(),
      purpose,
      ins_type,
      priority,
      status: 'waiting',
    })

    if (insertError) throw new Error('Could not add you to the queue. Please try again.')

    const { count } = await supabase
      .from('queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'waiting')
      .or(`priority.lt.${priority},and(priority.eq.${priority},token.neq.${token})`)

    setConfirmation({
      token,
      name: form.name.trim(),
      purposeText: purpose,
      isRenewal: form.visitKind === 'renewal',
      ins_label: ins_type_label,
      ahead: count ?? 0,
    })
    setSubmitting(false)
  }

  // ── No-token redirect card (enquiry / other) ─────────────────────────────
  if (noToken) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-700 to-slate-900 flex flex-col items-center justify-center p-6 text-white">
        <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
          <div className="bg-white/10 rounded-3xl p-8 w-full flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-3xl">
              ℹ️
            </div>
            <p className="text-lg font-semibold leading-snug">
              For general enquiries and complaints, please approach the{' '}
              <span className="text-orange-300 font-bold">counter</span> directly.
            </p>
            <p className="text-slate-300 text-sm leading-relaxed">
              No token needed — our staff there will assist you.
            </p>
          </div>
          <button
            onClick={() => {
              setNoToken(false)
              setForm({ name: '', phone: '', purposeText: '', visitKind: '', ins_type: '', ins_type_other: '' })
            }}
            className="bg-white/20 hover:bg-white/30 text-white font-semibold px-8 py-3 rounded-2xl transition-colors"
          >
            ← Back
          </button>
        </div>
      </main>
    )
  }

  // ── Confirmation screen ───────────────────────────────────────────────────
  if (confirmation) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-blue-600 to-blue-800 flex flex-col items-center justify-center p-6 text-white">
        <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
          <div className="bg-white/15 rounded-3xl p-8 w-full">
            <p className="text-blue-100 text-sm font-medium uppercase tracking-widest mb-2">
              Your Token Number
            </p>
            <p className="text-7xl font-black tracking-tight mb-1">{confirmation.token}</p>
            <p className="text-blue-200 text-sm">{confirmation.name}</p>
          </div>

          <div className="bg-white/10 rounded-2xl p-5 w-full text-left space-y-3">
            <Row label="Purpose" value={confirmation.purposeText} />
            <Row label="Insurance" value={confirmation.ins_label} />
            <Row
              label="People ahead"
              value={confirmation.ahead === 0 ? 'You are next!' : `${confirmation.ahead}`}
            />
          </div>

          <p className="text-blue-100 text-base leading-relaxed">
            Please take a seat. Your token will be called shortly.
          </p>

          <p className="text-blue-300 text-sm">
            This screen resets in <span className="font-bold text-white">{countdown}s</span>
          </p>
        </div>
      </main>
    )
  }

  // ── Check-in form ─────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-slate-50 flex flex-col items-center justify-start p-5 pt-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-800">Customer Check-in</h1>
          <p className="text-slate-500 mt-1 text-sm">Fill in your details to get a token number</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Name */}
          <Field label="Full Name">
            <input
              type="text"
              required
              placeholder="e.g. Rajesh Kumar"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input-field"
            />
          </Field>

          {/* Phone */}
          <Field label="Mobile Number">
            <input
              type="tel"
              required
              placeholder="10-digit mobile number"
              maxLength={10}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })}
              className="input-field"
            />
          </Field>

          {/* Purpose — free text (mandatory) */}
          <Field label={<>Why are you visiting today? <span className="text-red-500">*</span></>}>
            <textarea
              required
              rows={3}
              placeholder="e.g. I need to renew my car insurance policy that expires next week"
              value={form.purposeText}
              onChange={(e) => setForm({ ...form, purposeText: e.target.value })}
              className="input-field resize-none"
            />
          </Field>

          {/* Visit kind — drives token prefix and priority */}
          <Field label={<>Visit Type <span className="text-red-500">*</span></>}>
            <div className="flex flex-col gap-2">
              {([
                { value: 'renewal',     label: 'Policy Renewal',              sub: 'Your existing policy is expiring soon',           color: 'green'  },
                { value: 'new',         label: 'New Policy',                  sub: 'You want to take out a new insurance policy',     color: 'blue'   },
                { value: 'refund',      label: 'Refund',                      sub: 'You are here regarding a refund or claim payout', color: 'orange' },
                { value: 'enquiry',     label: 'General Enquiry / Complaint', sub: 'You have a question or complaint to raise',       color: 'slate'  },
                { value: 'other_visit', label: 'Other',                       sub: 'Something else not listed above',                color: 'slate'  },
              ] as const).map(({ value, label, sub, color }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setForm({ ...form, visitKind: value })}
                  className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors ${
                    form.visitKind === value
                      ? color === 'green'  ? 'border-green-500 bg-green-50 text-green-800'
                      : color === 'blue'   ? 'border-blue-500 bg-blue-50 text-blue-800'
                      : color === 'orange' ? 'border-orange-500 bg-orange-50 text-orange-800'
                      :                     'border-slate-500 bg-slate-50 text-slate-800'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                    form.visitKind === value
                      ? color === 'green'  ? 'border-green-500 bg-green-500'
                      : color === 'blue'   ? 'border-blue-500 bg-blue-500'
                      : color === 'orange' ? 'border-orange-500 bg-orange-500'
                      :                     'border-slate-500 bg-slate-500'
                      : 'border-slate-300'
                  }`}>
                    {form.visitKind === value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{label}</p>
                    <p className="text-xs opacity-70">{sub}</p>
                  </div>
                </button>
              ))}
            </div>
          </Field>

          {/* Insurance type — hidden for enquiry/other since no policy is involved */}
          {(form.visitKind === 'enquiry' || form.visitKind === 'other_visit') ? null : <Field label="Insurance Type">
            <select
              required
              value={form.ins_type}
              onChange={(e) => setForm({ ...form, ins_type: e.target.value as InsType | '', ins_type_other: '' })}
              className="input-field"
            >
              <option value="">Select type…</option>
              <option value="motor">Motor Insurance</option>
              <option value="health">Health Insurance</option>
              <option value="life">Life Insurance</option>
              <option value="property">Property / Fire Insurance</option>
              <option value="travel">Travel Insurance</option>
              <option value="personal_accident">Personal Accident Insurance</option>
              <option value="marine">Marine / Cargo Insurance</option>
              <option value="other">Other</option>
            </select>

            {/* Show text input when "Other" is selected */}
            {form.ins_type === 'other' && (
              <input
                type="text"
                required
                placeholder="Please specify your insurance type"
                value={form.ins_type_other}
                onChange={(e) => setForm({ ...form, ins_type_other: e.target.value })}
                className="input-field mt-2"
              />
            )}
          </Field>}

          {error && (
            <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold py-4 rounded-2xl text-lg transition-colors shadow-md"
          >
            {submitting ? 'Please wait…' : 'Get Token Number'}
          </button>
        </form>
      </div>
    </main>
  )
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-semibold text-slate-700">{label}</label>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm gap-4">
      <span className="text-blue-200 flex-shrink-0">{label}</span>
      <span className="font-semibold text-right">{value}</span>
    </div>
  )
}
