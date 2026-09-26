import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { LoadError } from '@/components/trak'
import { formatParentDate } from '@/lib/parent-data'

/* TRAK-76 (J6): the trainings a child was recorded at, from
   family_training_history(): date, focus labels and their own attendance.
   Nothing else about a session reaches a family (Kostas, TRAK-6, 25 Sep).
   The parent screen can reuse this with the selected child's id. */

type Row = { session_id: string; session_date: string; focus: string[] | null; attendance: string }
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: Row[] }
  | { kind: 'failed' }
  | { kind: 'awaiting_consent' }

const ATTENDANCE: Record<string, string> = { present: 'Present', late: 'Late', absent: 'Absent' }

export function TrainingHistory({ playerUserId, reloadOn }: { playerUserId: string; reloadOn?: unknown }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [retrying, setRetrying] = useState(false)
  // Only the newest request may write: a slow earlier one must not replace it.
  const latest = useRef(0)

  const load = async () => {
    const request = ++latest.current
    const { data, error } = await supabase.rpc('family_training_history' as any, { p_player_user_id: playerUserId })
    if (request !== latest.current) return
    setRetrying(false)
    if (error) {
      // Waiting for a parent's approval is not a failure, and not "no training".
      setState(error.message === 'consent_required' ? { kind: 'awaiting_consent' } : { kind: 'failed' })
      return
    }
    setState({ kind: 'ready', rows: (data as Row[] | null) ?? [] })
  }

  // A new account starts from loading; a same-account refresh re-reads in the
  // background and replaces what is shown with its own result.
  useEffect(() => { setState({ kind: 'loading' }) }, [playerUserId])
  useEffect(() => { void load() }, [playerUserId, reloadOn])

  return (
    <section aria-label="Training" className="mt-6">
      <div className="text-[10px] tracking-[0.1em] uppercase text-white/35 mb-2" style={{ fontFamily: "'DM Mono', monospace" }}>
        Training
      </div>
      {state.kind === 'loading' && (
        <div role="status" aria-label="Loading training" className="h-12 rounded-[12px] bg-white/[0.04] animate-pulse" />
      )}
      {state.kind === 'failed' && (
        <LoadError what="your training" retrying={retrying} onRetry={() => { setRetrying(true); void load() }} />
      )}
      {state.kind === 'awaiting_consent' && (
        <p className="text-[13px] text-white/60">Your training history appears once your parent approves.</p>
      )}
      {state.kind === 'ready' && state.rows.length === 0 && (
        <p className="text-[13px] text-white/60">No training recorded yet.</p>
      )}
      {state.kind === 'ready' && state.rows.length > 0 && (
        <ul className="space-y-2">
          {state.rows.map(row => (
            <li key={row.session_id}
              className="flex items-center justify-between rounded-[12px] border border-white/[0.07] px-4 py-3"
              style={{ background: '#101012' }}>
              <div>
                <div className="text-[13px] text-white/85">{row.focus?.length ? row.focus.join(' · ') : 'Training'}</div>
                <div className="text-[11px] text-white/40" style={{ fontFamily: "'DM Mono', monospace" }}>{formatParentDate(row.session_date)}</div>
              </div>
              <span className="text-[11px] text-white/60">{ATTENDANCE[row.attendance] ?? row.attendance}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
