import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, MetadataLabel } from '@/components/trak'
import { IconPassport, IconHowItWorks } from '@/components/icons/TrakIcons'
import { ChevronRight, Settings as SettingsIcon } from 'lucide-react'
import { trackEvent } from '@/lib/telemetry'
import { bandForScore } from '@/lib/rating-engine'
import RatingTrendChart from '@/components/player/RatingTrendChart'
import { ParentInviteCard } from '@/components/player/ParentInviteCard'
import { PlayerConnections } from '@/components/player/PlayerConnections'

type TrendFilter = 'last5' | 'last10' | 'all'

export default function PlayerProfilePage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [details, setDetails] = useState<any>(null)
  const [assessments, setAssessments] = useState<any[]>([])
  const assessment = assessments[0] ?? null
  const [matchHistory, setMatchHistory] = useState<{ created_at: string; computed_rating: number }[]>([])
  const [trendFilter, setTrendFilter] = useState<TrendFilter>('all')

  useEffect(() => {
    if (!user) return
    supabase.from('player_details').select('*').eq('user_id', user.id).maybeSingle().then(({ data }) => setDetails(data))
    supabase.from('matches').select('computed_rating, created_at').eq('user_id', user.id).order('created_at', { ascending: true }).then(({ data }) => {
      if (!data) return
      setMatchHistory(data.map((m) => ({ created_at: m.created_at ?? '', computed_rating: m.computed_rating })))
    })
    // Coach assessments, newest first — via squad_players, since
    // coach_assessments.squad_player_id is a row ID, not a user ID.
    supabase.from('squad_players').select('id').eq('linked_player_id', user.id)
      .then(async ({ data: squadRows }) => {
        if (!squadRows?.length) return
        const ids = squadRows.map((r: any) => r.id)
        const { data } = await supabase.from('coach_assessments')
          .select('id, created_at, work_rate, tactical, attitude, technical, physical, coachability')
          .in('squad_player_id', ids)
          .order('created_at', { ascending: false })
          .limit(10)
        setAssessments(data ?? [])
      })
  }, [user])

  // Track chart view once we have enough data
  useEffect(() => {
    if (matchHistory.length >= 3) {
      trackEvent('chart_viewed', { type: 'trend' })
    }
  }, [matchHistory])

  const filteredMatches = (() => {
    if (trendFilter === 'last5') return matchHistory.slice(-5)
    if (trendFilter === 'last10') return matchHistory.slice(-10)
    return matchHistory
  })()

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  const assessmentCategories = assessment ? [
    { name: 'Work Rate', score: assessment.work_rate },
    { name: 'Tactical', score: assessment.tactical },
    { name: 'Attitude', score: assessment.attitude },
    { name: 'Technical', score: assessment.technical },
    { name: 'Physical', score: assessment.physical },
    { name: 'Coachability', score: assessment.coachability },
  ] : []

  const FILTER_OPTIONS: { key: TrendFilter; label: string }[] = [
    { key: 'last5', label: 'Last 5' },
    { key: 'last10', label: 'Last 10' },
    { key: 'all', label: 'All' },
  ]

  return (
    <MobileShell>
      <div className="flex items-center justify-between pt-3 pb-2 border-b border-white/[0.07]">
        <span className="text-[16px] font-medium text-white/88" style={{ fontFamily: "'DM Sans', sans-serif" }}>Profile</span>
      </div>

      <div className="pt-3.5 pb-4 space-y-2.5">
        {/* Avatar + Identity */}
        <div className="text-center mb-6">
          <div className="w-[72px] h-[72px] rounded-[22px] overflow-hidden bg-[#202024] border border-[rgba(200,242,90,0.18)] mx-auto mb-3 flex items-center justify-center">
            <span className="text-2xl font-semibold text-primary" aria-hidden="true">
              {(profile?.full_name || '?').charAt(0).toUpperCase()}
            </span>
          </div>
          <p className="text-[20px] font-semibold text-white/88 tracking-tight" style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.02em' }}>
            {profile?.full_name}
          </p>
          <div className="flex justify-center gap-1.5 mt-2 flex-wrap">
            {details?.position && (
              <span className="h-5 px-2.5 rounded-full bg-white/[0.06] border border-white/[0.07] text-[8px] font-medium tracking-[0.06em] uppercase text-white/45 inline-flex items-center"
                style={{ fontFamily: "'DM Mono', monospace" }}>{details.position}</span>
            )}
            {details?.current_club && (
              <span className="h-5 px-2.5 rounded-full bg-white/[0.06] border border-white/[0.07] text-[8px] font-medium tracking-[0.06em] uppercase text-white/45 inline-flex items-center"
                style={{ fontFamily: "'DM Mono', monospace" }}>{details.current_club} {details.age_group}</span>
            )}
            {details?.shirt_number && (
              <span className="h-5 px-2.5 rounded-full bg-white/[0.06] border border-white/[0.07] text-[8px] font-medium tracking-[0.06em] uppercase text-white/45 inline-flex items-center"
                style={{ fontFamily: "'DM Mono', monospace" }}>#{details.shirt_number}</span>
            )}
          </div>
        </div>

        {/* Performance Trend */}
        <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
          <MetadataLabel text="PERFORMANCE TREND" />
          {matchHistory.length < 3 ? (
            <p className="text-[12px] text-white/30 mt-4 text-center pb-2" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              Log at least 3 matches to see your trend
            </p>
          ) : (
            <>
              <div className="mt-3">
                <RatingTrendChart matches={filteredMatches} />
              </div>
              <div className="flex gap-1.5 mt-3">
                {FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setTrendFilter(opt.key)}
                    className="h-[26px] px-3 rounded-full text-[9px] font-medium tracking-[0.06em] uppercase transition-colors"
                    style={{
                      fontFamily: "'DM Mono', monospace",
                      background: trendFilter === opt.key ? 'rgba(200,242,90,0.13)' : 'rgba(255,255,255,0.04)',
                      color: trendFilter === opt.key ? '#C8F25A' : 'rgba(255,255,255,0.3)',
                      border: `1px solid ${trendFilter === opt.key ? 'rgba(200,242,90,0.25)' : 'rgba(255,255,255,0.07)'}`,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Coach Assessments */}
        {assessmentCategories.length > 0 && (
          <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
            <MetadataLabel text="COACH ASSESSMENTS" />
            <div className="mt-3 space-y-2">
              {assessmentCategories.map(cat => {
                const bandInfo = bandForScore(cat.score)
                const pct = (cat.score / 10) * 100
                return (
                  <div key={cat.name} className="flex items-center gap-2.5">
                    <span className="text-[11px] text-white/88 w-[110px] flex-shrink-0">{cat.name}</span>
                    <div className="flex-1 h-[5px] rounded-full bg-white/[0.06] overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: bandInfo.color }} />
                    </div>
                    <span className="text-[11px] font-semibold w-[68px] text-right flex-shrink-0" style={{ color: bandInfo.color }}>
                      {bandInfo.word}
                    </span>
                  </div>
                )
              })}
            </div>
              {assessments.length > 0 && (
                <ul className="mt-3 pt-3 border-t border-white/[0.06] space-y-1" aria-label="Assessment history">
                  {assessments.map(a => {
                    const band = bandForScore((a.work_rate + a.tactical + a.attitude + a.technical + a.physical + a.coachability) / 6)
                    return (
                      <li key={a.id}>
                        <button onClick={() => navigate(`/player/feedback/${a.id}`)}
                          className="w-full flex items-center justify-between py-2 text-left">
                          <span className="text-[12px] text-white/70">
                            {new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                          <span className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: band.color }}>
                            {band.word}<ChevronRight size={14} className="text-white/40" />
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
          </div>
        )}

        {/* My Passport */}
        <button
          onClick={() => navigate('/player/passport')}
          className="w-full flex items-center justify-between rounded-[18px] p-4 border border-white/[0.07] bg-[#101012] text-left hover:bg-[#141416] transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(200,242,90,0.08)', border: '1px solid rgba(200,242,90,0.2)' }}>
              <IconPassport size={16} color="#C8F25A" />
            </div>
            <div>
              <MetadataLabel text="MY PASSPORT" />
              <p className="text-[12px] text-white/55 mt-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Coming soon
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="text-white/40" />
        </button>

        {/* Connections, moved here from Settings (TRAK-71) */}
        <PlayerConnections />

        {/* Parent access */}
        <ParentInviteCard />

        {/* How TRAK works link */}
        <button
          onClick={() => navigate('/how-it-works')}
          className="w-full flex items-center justify-between rounded-[18px] p-4 border border-white/[0.07] bg-[#101012] text-left hover:bg-[#141416] transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(200,242,90,0.08)', border: '1px solid rgba(200,242,90,0.18)' }}>
              <IconHowItWorks size={16} color="#C8F25A" />
            </div>
            <div>
              <MetadataLabel text="HOW TRAK WORKS" />
              <p className="text-[12px] text-white/55 mt-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Performance bands & rating engine
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="text-white/40" />
        </button>

        {/* Settings entry */}
        <button
          onClick={() => navigate('/settings')}
          className="w-full flex items-center justify-between rounded-[18px] p-4 border border-white/[0.07] bg-[#101012] text-left hover:bg-[#141416] transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center">
              <SettingsIcon size={16} className="text-white/55" />
            </div>
            <div>
              <MetadataLabel text="SETTINGS" />
              <p className="text-[12px] text-white/55 mt-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Account, notifications, privacy
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="text-white/40" />
        </button>


      </div>
      <NavBar role="player" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
