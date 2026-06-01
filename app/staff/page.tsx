'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { QueueRow, InsType } from '@/lib/supabase'

const INS_LABELS: Record<InsType, string> = {
  motor: 'Motor',
  health: 'Health',
  life: 'Life',
  property: 'Property',
  travel: 'Travel',
  personal_accident: 'Personal Accident',
  marine: 'Marine',
  other: 'Other',
}

// ── Policy queue sort (R and N tokens) ───────────────────────────────────────
// Rule 1: Escalated customers (waited 20+ min) always first.
// Rule 2: Renewals (priority 1) before new policies (priority 2) — a lapsed
//         renewal means immediate loss of coverage; new policy can wait longer.
// Rule 3: FIFO within same escalation + priority group.
function sortPolicyQueue(rows: QueueRow[]): QueueRow[] {
  return [...rows].sort((a, b) => {
    if (a.escalated !== b.escalated) return a.escalated ? -1 : 1
    if (a.priority !== b.priority) return a.priority - b.priority
    return new Date(a.arrived_at).getTime() - new Date(b.arrived_at).getTime()
  })
}

// ── Refund queue sort (RF tokens) ────────────────────────────────────────────
// Completely independent of policy queue. Escalated first, then strict FIFO.
function sortRefundQueue(rows: QueueRow[]): QueueRow[] {
  return [...rows].sort((a, b) => {
    if (a.escalated !== b.escalated) return a.escalated ? -1 : 1
    return new Date(a.arrived_at).getTime() - new Date(b.arrived_at).getTime()
  })
}

function waitMinutes(arrived_at: string): number {
  return Math.floor((Date.now() - new Date(arrived_at).getTime()) / 60000)
}

type Tab = 'policy' | 'refund' | 'served'

export default function StaffPage() {
  const [policyWaiting, setPolicyWaiting] = useState<QueueRow[]>([])
  const [refundWaiting, setRefundWaiting] = useState<QueueRow[]>([])
  const [served, setServed] = useState<QueueRow[]>([])
  const [banner, setBanner] = useState<{ text: string; color: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('policy')

  const fetchQueue = useCallback(async () => {
    const { data, error } = await supabase
      .from('queue')
      .select('*')
      .order('arrived_at', { ascending: true })

    if (error) { console.error('Fetch error:', error); return }

    const rows = data as QueueRow[]
    setPolicyWaiting(rows.filter((r) => r.status === 'waiting' && r.priority !== 3))
    setRefundWaiting(rows.filter((r) => r.status === 'waiting' && r.priority === 3))
    setServed(rows.filter((r) => r.status === 'called' || r.status === 'served').reverse())
    setLoading(false)
  }, [])

  const runEscalation = useCallback(async () => {
    const cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    await supabase
      .from('queue')
      .update({ escalated: true })
      .eq('status', 'waiting')
      .eq('escalated', false)
      .lt('arrived_at', cutoff)
  }, [])

  useEffect(() => {
    fetchQueue()
    const channel = supabase
      .channel('queue-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue' }, fetchQueue)
      .subscribe()
    runEscalation()
    const escalationTimer = setInterval(() => { runEscalation(); fetchQueue() }, 60_000)
    return () => { supabase.removeChannel(channel); clearInterval(escalationTimer) }
  }, [fetchQueue, runEscalation])

  async function callNextPolicy() {
    const next = sortPolicyQueue(policyWaiting)[0]
    if (!next) return
    const { error } = await supabase
      .from('queue')
      .update({ status: 'called', served_at: new Date().toISOString() })
      .eq('id', next.id)
    if (error) { console.error(error); return }
    setBanner({ text: `Now serving: ${next.token} — ${next.name}`, color: 'bg-green-600' })
    setTimeout(() => setBanner(null), 5000)
    fetchQueue()
  }

  async function callNextRefund() {
    const next = sortRefundQueue(refundWaiting)[0]
    if (!next) return
    const { error } = await supabase
      .from('queue')
      .update({ status: 'called', served_at: new Date().toISOString() })
      .eq('id', next.id)
    if (error) { console.error(error); return }
    setBanner({ text: `Now serving: ${next.token} — ${next.name}`, color: 'bg-orange-500' })
    setTimeout(() => setBanner(null), 5000)
    fetchQueue()
  }

  const sortedPolicy = sortPolicyQueue(policyWaiting)
  const sortedRefunds = sortRefundQueue(refundWaiting)

  return (
    <main className="min-h-screen bg-slate-100">
      {/* Calling banner */}
      {banner && (
        <div className={`fixed top-0 left-0 right-0 z-50 ${banner.color} text-white text-center py-4 text-lg sm:text-2xl font-bold shadow-lg animate-pulse px-4`}>
          {banner.text}
        </div>
      )}

      <div className="max-w-6xl mx-auto flex flex-col gap-4 p-4 md:p-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Staff Dashboard</h1>
            <p className="text-slate-500 text-xs sm:text-sm">Live queue — updates automatically</p>
          </div>
        </div>

        {/* Stats — 2×2 on mobile, 4 across on sm+ */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Policy Waiting" value={policyWaiting.length} color="text-slate-700" />
          <StatCard label="Renewals" value={policyWaiting.filter(r => r.priority === 1).length} color="text-green-700" />
          <StatCard label="New Policies" value={policyWaiting.filter(r => r.priority === 2).length} color="text-blue-700" />
          <StatCard label="Refunds" value={refundWaiting.length} color="text-orange-600" />
        </div>

        {/* Mobile tab switcher — hidden on large screens */}
        <div className="flex rounded-xl overflow-hidden border border-slate-200 bg-white lg:hidden">
          {([
            { key: 'policy', label: `Policy (${policyWaiting.length})` },
            { key: 'refund', label: `Refunds (${refundWaiting.length})` },
            { key: 'served', label: `Served (${served.length})` },
          ] as { key: Tab; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
                activeTab === key
                  ? key === 'refund' ? 'bg-orange-500 text-white'
                    : key === 'served' ? 'bg-slate-600 text-white'
                    : 'bg-blue-600 text-white'
                  : 'text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Desktop: side-by-side queues ── Mobile: tabbed ──────────────── */}

        {/* Policy Queue */}
        <div className={`flex flex-col gap-3 ${activeTab !== 'policy' ? 'hidden lg:flex' : ''}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-800 text-base sm:text-lg">Policy Queue</h2>
              <p className="text-xs text-slate-500">Renewals · New Policies</p>
            </div>
            <button
              onClick={callNextPolicy}
              disabled={policyWaiting.length === 0}
              className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 text-white font-bold px-5 py-2.5 rounded-xl shadow transition-colors text-sm sm:text-base"
            >
              Call Next
            </button>
          </div>
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            {loading && <p className="text-slate-400 text-center py-10">Loading…</p>}
            {!loading && sortedPolicy.length === 0 && (
              <p className="text-slate-400 text-center py-10 text-sm">No customers waiting</p>
            )}
            {sortedPolicy.map((row, idx) => (
              <QueueRowCard key={row.id} row={row} idx={idx} />
            ))}
          </section>
        </div>

        {/* Refund Queue */}
        <div className={`flex flex-col gap-3 ${activeTab !== 'refund' ? 'hidden lg:flex' : ''}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-800 text-base sm:text-lg">Refund Queue</h2>
              <p className="text-xs text-slate-500">Independent counter · RF tokens</p>
            </div>
            <button
              onClick={callNextRefund}
              disabled={refundWaiting.length === 0}
              className="bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:opacity-40 text-white font-bold px-5 py-2.5 rounded-xl shadow transition-colors text-sm sm:text-base"
            >
              Call Next
            </button>
          </div>
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            {loading && <p className="text-slate-400 text-center py-10">Loading…</p>}
            {!loading && sortedRefunds.length === 0 && (
              <p className="text-slate-400 text-center py-10 text-sm">No refund customers waiting</p>
            )}
            {sortedRefunds.map((row, idx) => (
              <QueueRowCard key={row.id} row={row} idx={idx} isRefund />
            ))}
          </section>
        </div>

        {/* Served today */}
        <section className={`bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden ${activeTab !== 'served' ? 'hidden lg:block' : ''}`}>
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-slate-700 text-sm sm:text-base">Served Today ({served.length})</h2>
          </div>
          {served.length === 0 && (
            <p className="text-slate-400 text-center py-8 text-sm">None yet</p>
          )}
          {served.map((row) => (
            <div key={row.id} className="flex items-center gap-3 px-4 py-3 border-b border-slate-50 last:border-0 opacity-70">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${
                row.priority === 3 ? 'bg-orange-100 text-orange-700'
                : row.priority === 1 ? 'bg-green-100 text-green-700'
                : 'bg-blue-100 text-blue-700'
              }`}>
                {row.token}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">{row.name}</p>
                <p className="text-xs text-slate-400">{INS_LABELS[row.ins_type] ?? row.ins_type}</p>
              </div>
              <span className="text-xs text-slate-400 flex-shrink-0">
                {row.served_at
                  ? new Date(row.served_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                  : '—'}
              </span>
            </div>
          ))}
        </section>

      </div>
    </main>
  )
}

function QueueRowCard({ row, idx, isRefund = false }: { row: QueueRow; idx: number; isRefund?: boolean }) {
  const wait = waitMinutes(row.arrived_at)
  return (
    <div className={`flex items-center gap-3 px-4 py-4 border-b border-slate-50 last:border-0 ${
      row.escalated ? 'bg-red-50' : idx === 0 ? (isRefund ? 'bg-orange-50' : 'bg-blue-50') : ''
    }`}>
      <span className="text-slate-400 text-xs w-4 text-center flex-shrink-0">{idx + 1}</span>
      <span className={`text-sm font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${
        row.escalated ? 'bg-red-100 text-red-700'
        : isRefund ? 'bg-orange-100 text-orange-700'
        : row.priority === 1 ? 'bg-green-100 text-green-700'
        : 'bg-blue-100 text-blue-700'
      }`}>
        {row.token}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-800 truncate text-sm">{row.name}</p>
        <p className="text-xs text-slate-500">{INS_LABELS[row.ins_type] ?? row.ins_type}</p>
        {row.purpose && <p className="text-xs text-slate-400 truncate italic">{row.purpose}</p>}
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-semibold text-slate-700">{wait}m</p>
        {row.escalated && (
          <span className="text-xs font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">!</span>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-3 sm:p-4 text-center">
      <p className={`text-2xl sm:text-3xl font-black ${color}`}>{value}</p>
      <p className="text-slate-500 text-xs mt-1">{label}</p>
    </div>
  )
}
