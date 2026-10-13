import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function WorkspacePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <main className="min-h-screen bg-[#050505] p-8 text-white"><div className="mx-auto max-w-5xl"><p className="mb-3 text-[10px] uppercase tracking-[.25em] text-[#ff5100]">Protected workspace</p><h1 className="text-5xl font-semibold tracking-[-.06em]">Welcome to the vault.</h1><p className="mt-4 text-sm text-zinc-500">Signed in as {user.email}</p><div className="mt-12 grid gap-4 md:grid-cols-3"><div className="border border-zinc-800 bg-zinc-950 p-6"><p className="text-xs text-zinc-500">FILES INDEXED</p><p className="mt-3 text-4xl font-bold text-[#ff5100]">00</p></div><div className="border border-zinc-800 bg-zinc-950 p-6"><p className="text-xs text-zinc-500">SECURITY STATUS</p><p className="mt-3 text-lg text-emerald-400">NOMINAL</p></div><div className="border border-zinc-800 bg-zinc-950 p-6"><p className="text-xs text-zinc-500">AI LAYER</p><p className="mt-3 text-lg text-zinc-300">STANDBY</p></div></div></div></main>
}
