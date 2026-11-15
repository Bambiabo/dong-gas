import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Dong Gas Management</h1>
        <p className="text-slate-400 text-sm">Select your portal to continue</p>
        
        <div className="space-y-4 pt-4">
          <Link
            href="/supervisor"
            className="block w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-medium transition-colors text-center shadow-lg"
          >
            Supervisor (Close Shift)
          </Link>
          
          <Link
            href="/owner"
            className="block w-full py-3.5 px-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl font-medium transition-colors text-center"
          >
            Owner Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}