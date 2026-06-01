import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col items-center justify-center p-8">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">Insurance Branch</h1>
        <p className="text-slate-500 text-lg">Queue Management System</p>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <Link
          href="/checkin"
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-center py-5 px-6 rounded-2xl shadow-md transition-colors text-lg"
        >
          Customer Check-in
        </Link>
        <Link
          href="/staff"
          className="bg-slate-700 hover:bg-slate-800 text-white font-semibold text-center py-5 px-6 rounded-2xl shadow-md transition-colors text-lg"
        >
          Staff Dashboard
        </Link>
        <Link
          href="/qr"
          className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold text-center py-5 px-6 rounded-2xl shadow-sm transition-colors text-lg"
        >
          QR Code (Print / Display)
        </Link>
      </div>
    </main>
  )
}
