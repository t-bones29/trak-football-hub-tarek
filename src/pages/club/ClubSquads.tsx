import { useEffect, useState } from 'react'
import { ClubShell, ClubCard, SectionLabel } from '@/components/club/ClubShell'
import { LoadError } from '@/components/trak/LoadError'
import { AcademyDashboardHeader } from './AcademyDashboardHeader'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { scoreToBand } from '@/lib/rating-engine'
import { BANDS } from '@/lib/types'
import { AlertTriangle } from 'lucide-react'

type PlayerRow = {
  id: string
  name: string
  position: string
  ageGroup: string
  coachName: string
  latestBand: string
  latestBandColor: string
  matchCount: number
  status: string
}

function initials(name: string) {
  return name.split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2)
}

function getBandConfig(bandKey: string) {
  return BANDS.find(b => b.word.toLowerCase() === bandKey) || BANDS[4]
}

export default function ClubSquads() {
  const { user } = useAuth()
  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [orphanedPlayers, setOrphanedPlayers] = useState<PlayerRow[]>([])
  const [ageGroups, setAgeGroups] = useState<string[]>([])
  const [filter, setFilter] = useState<string>('All')
  const [loading, setLoading] = useState(true)
  const [coachCount, setCoachCount] = useState(0)
  const [clubName, setClubName] = useState('Academy')
  const [loadFailed, setLoadFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [ownerId, setOwnerId] = useState<string>()
  const userId = user?.id

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    setOwnerId(userId)
    setPlayers([])
    setOrphanedPlayers([])
    setAgeGroups([])
    setFilter('All')
    setCoachCount(0)
    setClubName('Academy')
    setLoading(true)
    setLoadFailed(false)
    if (!userId) return () => controller.abort()

    const loadData = async () => {
      // Fetch org name
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('admin_user_id', userId)
        .abortSignal(signal)
        .maybeSingle()

      if (signal.aborted) return
      if (orgError) throw orgError
      if (!org) throw new Error('Academy not available')
      if (org?.name) setClubName(org.name)

      // Fetch all squad players (RLS scoped to org)
      const { data: squadData, error: squadError } = await supabase
        .from('squad_players')
        .select('id, player_name, position, age, age_group, linked_player_id, coach_user_id, status')
        .order('player_name')
        .abortSignal(signal)

      if (signal.aborted) return
      if (squadError) throw squadError
      if (!squadData) throw new Error('Roster not available')

      const coachIds = [...new Set(squadData.filter(s => s.coach_user_id).map(s => s.coach_user_id!))]

      // The header's coach count is the academy's coaches, the same query Home
      // uses, not the coaches who happen to have roster rows. Counting from the
      // roster showed "2 Coaches" here and "3 Coaches" on Home for the same
      // academy (a goalkeeping coach with no players yet is still a coach).
      const { data: academyCoaches, error: academyCoachError } = await supabase
        .from('coach_details')
        .select('user_id')
        .abortSignal(signal)
      if (signal.aborted) return
      if (academyCoachError) throw academyCoachError

      // Fetch coach names
      const coachNameMap: Record<string, string> = {}
      if (coachIds.length > 0) {
        const { data: coachProfiles, error: profileError } = await supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', coachIds)
          .abortSignal(signal)
        if (signal.aborted) return
        if (profileError) throw profileError
        for (const p of coachProfiles ?? []) { coachNameMap[p.user_id] = p.full_name || 'Coach' }
      }

      // Fetch latest assessment per squad player for band
      const squadIds = squadData.map(s => s.id)
      const { data: assessments, error: assessmentError } = squadIds.length > 0 ? await supabase
        .from('coach_assessments')
        .select('squad_player_id, work_rate, tactical, attitude, technical, physical, coachability')
        .in('squad_player_id', squadIds)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .abortSignal(signal)
        : { data: null, error: null }
      if (signal.aborted) return
      if (assessmentError) throw assessmentError

      const latestAssessment: Record<string, NonNullable<typeof assessments>[0]> = {}
      for (const a of assessments ?? []) {
        if (!latestAssessment[a.squad_player_id]) latestAssessment[a.squad_player_id] = a
      }

      // Fetch match counts for linked players
      const linkedIds = squadData.filter(s => s.linked_player_id).map(s => s.linked_player_id!)
      const matchCountMap: Record<string, number> = {}
      if (linkedIds.length > 0) {
        const { data: matchRows, error: matchError } = await supabase
          .from('matches')
          .select('user_id')
          .in('user_id', linkedIds)
          .abortSignal(signal)
        if (signal.aborted) return
        if (matchError) throw matchError
        for (const m of matchRows ?? []) {
          matchCountMap[m.user_id] = (matchCountMap[m.user_id] || 0) + 1
        }
      }

      const rows: PlayerRow[] = squadData.map(sp => {
        const a = latestAssessment[sp.id]
        let latestBand: string | null = null
        if (a) {
          const scores = [a.work_rate, a.tactical, a.attitude, a.technical, a.physical, a.coachability]
            .filter((score): score is number => score != null)
          if (scores.length > 0) {
            latestBand = scoreToBand(scores.reduce((s, n) => s + n, 0) / scores.length)
          }
        }
        const bandCfg = latestBand === null ? null : getBandConfig(latestBand)
        const matchCount = sp.linked_player_id ? (matchCountMap[sp.linked_player_id] || 0) : 0

        return {
          id: sp.id,
          name: sp.player_name,
          position: sp.position || '—',
          ageGroup: sp.age_group ?? (sp.age != null ? String(sp.age) : '—'),
          coachName: sp.coach_user_id ? (coachNameMap[sp.coach_user_id] || 'Coach') : 'No coach',
          latestBand: bandCfg?.word ?? 'Unassessed',
          latestBandColor: bandCfg?.color ?? '',
          matchCount,
          status: sp.status || 'active',
        }
      })

      // Separate orphaned players (coach departed / no coach)
      const orphaned = rows.filter(r => r.status === 'coach_departed')
      const active = rows.filter(r => r.status !== 'coach_departed')

      setOrphanedPlayers(orphaned)
      setPlayers(active)
      setCoachCount((academyCoaches ?? []).length)

      // Collect unique age groups for filter
      const groups = ['All', ...Array.from(new Set(rows.map(r => r.ageGroup).filter(g => g !== '—'))).sort()]
      setAgeGroups(groups)
      setLoading(false)
    }

    void loadData().catch(() => {
      if (signal.aborted) return
      setLoadFailed(true)
      setLoading(false)
    })
    return () => controller.abort()
  }, [userId, retry])

  const currentAccount = ownerId === userId
  const pending = !currentAccount || loading
  const failed = currentAccount && loadFailed
  const ready = !pending && !failed

  const filtered = filter === 'All' ? players : players.filter(p => p.ageGroup === filter)

  return (
    <ClubShell>
      <AcademyDashboardHeader club={currentAccount ? clubName : 'Academy'} coaches={ready ? coachCount : null} />

      {/* Orphaned players alert */}
      {ready && orphanedPlayers.length > 0 && (
        <>
          <SectionLabel>
            <span className="flex items-center gap-1.5">
              <AlertTriangle size={12} style={{ color: '#F59E0B' }} />
              Players Without a Coach
            </span>
          </SectionLabel>
          <div className="mt-3 mb-6 space-y-2">
            <div className="px-4 py-3 mb-3" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, color: 'rgba(245,158,11,0.8)', fontSize: 12, lineHeight: 1.5 }}>
              These players' coach has left the academy. Their assessment history is preserved. Assign them to a new coach to continue tracking.
            </div>
            {orphanedPlayers.map(p => (
              <ClubCard key={p.id} className="p-3 flex items-center gap-3" style={{ borderColor: 'rgba(245,158,11,0.15)' }}>
                <div className="flex items-center justify-center shrink-0"
                  style={{ width: 40, height: 40, borderRadius: 999, background: 'rgba(245,158,11,0.1)', color: '#F59E0B', fontSize: 13 }}>
                  {initials(p.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.88)' }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                    {p.position} · {p.ageGroup}
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[11px]"
                  style={{ color: '#F59E0B', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
                  Unassigned
                </span>
              </ClubCard>
            ))}
          </div>
        </>
      )}

      <SectionLabel>Filter by age group</SectionLabel>
      <div className="mt-3 mb-5 flex gap-2 flex-wrap">
        {(ready ? ageGroups : []).map(g => {
          const active = filter === g
          return (
            <button key={g} onClick={() => setFilter(g)} className="px-3 py-1.5 rounded-full text-xs"
              style={active
                ? { color: '#000', background: '#C8F25A', border: '1px solid #C8F25A' }
                : { color: 'rgba(255,255,255,0.45)', background: 'transparent', border: '1px solid rgba(255,255,255,0.07)' }}>
              {g}
            </button>
          )
        })}
      </div>

      <SectionLabel>{ready ? filtered.length : '—'} Players</SectionLabel>
      <div className="mt-3 space-y-2">
        {failed ? (
          <div className="[&_button]:min-h-11">
            <LoadError what="your academy squads" onRetry={() => setRetry(value => value + 1)} />
          </div>
        ) : pending ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, paddingTop: 8 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, paddingTop: 8 }}>No players found.</div>
        ) : (
          filtered.map(p => (
            <ClubCard key={p.id} className="p-3 flex items-center gap-3">
              <div className="flex items-center justify-center shrink-0"
                style={{ width: 40, height: 40, borderRadius: 999, background: 'rgba(200,242,90,0.1)', color: '#C8F25A', fontSize: 13 }}>
                {initials(p.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.88)' }}>{p.name}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                  {p.position} · {p.ageGroup} · {p.matchCount} matches
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{p.coachName}</div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[11px] text-muted-foreground border border-border"
                style={p.latestBandColor ? { color: p.latestBandColor, background: `${p.latestBandColor}1F`, border: `1px solid ${p.latestBandColor}40` } : undefined}>
                {p.latestBand}
              </span>
            </ClubCard>
          ))
        )}
      </div>
    </ClubShell>
  )
}
