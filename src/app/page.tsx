import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-4xl font-bold text-amber-400 mb-2">Dong Gas</h1>
      <p className="text-slate-400 mb-10 text-center">Fuel & LPG Shift Reconciliation System</p>

      <div className="w-full max-w-sm space-y-4">
        <Link
          href="/supervisor"
          className="block w-full py-4 bg-amber-500 text-black text-center font-bold rounded-xl text-lg"
        >
          Supervisor (Close Shift)
        </Link>

        <Link
          href="/owner"
          className="block w-full py-4 bg-slate-700 text-white text-center font-bold rounded-xl text-lg"
        >
          Owner Dashboard
        </Link>
      </div>
    </div>
  )
}