'use client'

import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

export default function QRPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const checkinUrl = `${window.location.origin}/checkin`
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, checkinUrl, {
        width: 320,
        margin: 3,
        color: { dark: '#1e3a5f', light: '#ffffff' },
      })
    }
  }, [])

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center p-10 print:p-4">
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
          Insurance Branch Queue
        </h1>

        <div className="border-4 border-slate-800 rounded-2xl p-6 bg-white shadow-lg print:shadow-none">
          <canvas ref={canvasRef} className="block" />
        </div>

        <div className="space-y-1">
          <p className="text-xl font-semibold text-slate-800">Scan to join the queue</p>
          <p className="text-slate-500 text-sm">
            Open your phone camera and point it at the QR code
          </p>
        </div>

        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl px-6 py-4 text-sm text-blue-700 max-w-xs">
          Fill in your details and get your token number instantly — no app needed.
        </div>
      </div>

      {/* Print button — hidden when printing */}
      <button
        onClick={() => window.print()}
        className="mt-10 text-slate-400 hover:text-slate-600 text-sm underline print:hidden"
      >
        Print this page
      </button>
    </main>
  )
}
