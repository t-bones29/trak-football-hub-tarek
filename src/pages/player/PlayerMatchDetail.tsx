import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, BandPill, MetadataLabel, NavBar, LoadError } from '@/components/trak'
import { scoreToBand } from '@/lib/rating-engine'
import { ChevronLeft } from 'lucide-react'

/* Also the parent's match detail (TRAK-73): `role` picks the nav and the way
   back, and `limitedFor` says whether a child's match shows only what the
   parent already saw on their list (score, opponent, competition, venue, band). */
export default function PlayerMatchDetail({ role = 'player', limitedFor }: {
  role?: 'player' | 'parent'
  limitedFor?: (childId: string) => boolean
}) {
  const matchesPath = `/${role}/matches`
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [reloadKey, setReloadKey] = useState(0)
  const [result, setResult] = useState<{
    id: string
    user: typeof user
    reloadKey: number
    match: any
    failed: boolean
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    if (!id || !user) return
    supabase.from('matches').select('*').eq('id', id).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        setResult({ id, user, reloadKey, match: data, failed: Boolean(error) })
      })
    return () => { cancelled = true }
  }, [id, user, reloadKey])

  // Bind the displayed result to its request as well as cancelling old writes.
  // A new route or Auth refresh must hide the prior match before its effect runs.
  const currentResult = result && result.id === id && result.user === user && result.reloadKey === reloadKey
    ? result : null

  if (!currentResult) return (
    <MobileShell>
      <div className="flex items-center justify-center h-[60vh]" role="status" aria-label="Loading match">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    </MobileShell>
  )

  const match = currentResult.match
  if (currentResult.failed || !match) return (
    <MobileShell>
      <div className="pt-12 pb-4 space-y-4">
        {currentResult.failed ? (
          <LoadError what="this match" onRetry={() => setReloadKey(k => k + 1)} />
        ) : (
          <p className="text-center text-[13px] text-white/70" role="status">This match is unavailable.</p>
        )}
        <button onClick={() => navigate(matchesPath)}
          className="flex items-center gap-2 mx-auto px-4 py-2 rounded-[10px] text-[12px] text-white/70 border border-white/[0.07]">
          <ChevronLeft size={14} />
          Back to matches
        </button>
      </div>
      <NavBar role={role} activeTab={matchesPath} onNavigate={navigate} />
    </MobileShell>
  )

  const limited = limitedFor?.(match.user_id) ?? false
  const band = scoreToBand(match.computed_rating || 6.5)
  const resultLabel = match.team_score > match.opponent_score ? 'W'
    : match.team_score < match.opponent_score ? 'L' : 'D'
  const resultColor = resultLabel === 'W' ? '#4ade80' : resultLabel === 'L' ? '#f87171' : '#60a5fa'
  const formattedDate = new Date(match.created_at).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <MobileShell>
      <div className="pt-6 pb-24 space-y-3">
        {/* Back */}
        <button onClick={() => navigate(-1)}
          className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-[#17171a] border border-white/[0.11] mb-2">
          <ChevronLeft size={16} className="text-white/70" />
        </button>

        {/* Hero card: result + band */}
        <div className="relative rounded-[24px] p-5 overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #101012 0%, #0f0f12 100%)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="absolute -bottom-[60px] -right-[60px] w-[200px] h-[200px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(200,242,90,0.08) 0%, transparent 70%)' }} />
          <div className="relative z-10">
            <MetadataLabel text={formattedDate} />
            <div className="flex items-start justify-between mt-2">
              <div>
                <div className="flex items-baseline gap-3">
                  <span className="text-[48px] font-light text-white/88 leading-none"
                    style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.04em' }}>
                    {match.team_score}–{match.opponent_score}
                  </span>
                  <span className="text-[20px] font-semibold" style={{ color: resultColor }}>{resultLabel}</span>
                </div>
                {match.opponent && (
                  <p className="text-[11px] text-white/35 mt-1" style={{ fontFamily: "'DM Mono', monospace" }}>
                    vs {match.opponent}
                  </p>
                )}
              </div>
              <BandPill band={band} />
            </div>
          </div>
        </div>

        {/* Match info */}
        <div className="rounded-[18px] p-4 space-y-3"
          style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.07)' }}>
          <MetadataLabel text="MATCH INFO" />
          {[
            { label: 'Competition', value: match.competition },
            { label: 'Venue', value: match.venue },
            ...(limited ? [] : [
              { label: 'Position', value: match.position },
              { label: 'Age Group', value: match.age_group },
              { label: 'Minutes', value: `${match.minutes_played}'` },
            ]),
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between">
              <span className="text-[11px] text-white/35" style={{ fontFamily: "'DM Mono', monospace" }}>
                {row.label}
              </span>
              <span className="text-[13px] text-white/88">{row.value || '—'}</span>
            </div>
          ))}
        </div>

        {/* Goal contributions */}
        {!limited && <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Goals', value: match.goals ?? 0 },
            { label: 'Assists', value: match.assists ?? 0 },
          ].map(stat => (
            <div key={stat.label} className="rounded-[14px] py-4 px-3 text-center"
              style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.07)' }}>
              <p className="text-[28px] font-light text-white/88 leading-none"
                style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.03em' }}>{stat.value}</p>
              <span className="text-[9px] text-white/35 mt-1.5 block"
                style={{ fontFamily: "'DM Mono', monospace" }}>{stat.label}</span>
            </div>
          ))}
        </div>}

      </div>
      <NavBar role={role} activeTab={matchesPath} onNavigate={navigate} />
    </MobileShell>
  )
}
