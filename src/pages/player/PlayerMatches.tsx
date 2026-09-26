import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, MatchCard, LoadError } from '@/components/trak'
import { scoreToBand } from '@/lib/rating-engine'
import { TrainingHistory } from '@/components/player/TrainingHistory'

const FILTERS = ['All', 'League', 'Cup', 'Friendly']
const PAGE_SIZE = 20

export default function PlayerMatches() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [matches, setMatches] = useState<any[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [pageFailed, setPageFailed] = useState(false)

  const fetchPage = async (pageIndex: number, append: boolean) => {
    if (!user) return
    if (pageIndex > 0) setLoadingMore(true)
    const from = pageIndex * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase.from('matches').select('*')
      .eq('user_id', user.id)
      // match_date is a `date`, and the pilot migration backfills it from
      // created_at::date with a CURRENT_DATE default, so twenty rows sharing
      // one date is ordinary. Ties have no defined order across separate
      // executions, so paging over match_date alone lets Load more re-append
      // rows already on screen and drop the ones they displaced — the same
      // silent gap this PR fixes, arriving from the ordering side.
      .order('match_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)
    if (pageIndex > 0) setLoadingMore(false)
    setLoading(false)

    // A failed read is not an empty season. Without this the screen told a
    // player with a full record that they had never played a match.
    if (error) {
      if (append) setPageFailed(true)
      else setFailed(true)
      return
    }

    // Only advance once the page is actually in hand. Advancing on request
    // meant a failed page 2 left the cursor at 2, so the next Load more
    // fetched page 3 and the middle twenty matches vanished without a word.
    setPage(pageIndex)
    setPageFailed(false)
    setFailed(false)

    const rows = data || []
    setHasMore(rows.length === PAGE_SIZE)
    if (append) {
      setMatches(prev => [...prev, ...rows])
    } else {
      setMatches(rows)
    }
  }

  const retry = () => { setLoading(true); setFailed(false); fetchPage(0, false) }

  useEffect(() => {
    if (!user) return
    fetchPage(0, false)
  }, [user])

  // Always re-requests the page after the last one successfully loaded, so a
  // retry cannot skip a page and a double tap cannot request two.
  const loadMore = () => {
    if (loadingMore) return
    fetchPage(page + 1, true)
  }

  const [filter, setFilter] = useState('All')
  const filtered = filter === 'All' ? matches : matches.filter(m => m.competition === filter)

  return (
    <MobileShell>
      <div className="pt-3 pb-28">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[9px] tracking-[0.12em] uppercase text-white/35 mb-0.5"
              style={{ fontFamily: "'DM Mono', monospace" }}>Player</p>
            <h1 className="text-[22px] font-light text-white/88 leading-tight"
              style={{ fontFamily: "'DM Sans', sans-serif" }}>Matches</h1>
          </div>
          <span className="text-[10px] text-white/30" style={{ fontFamily: "'DM Mono', monospace" }}>
            {failed ? '—' : `${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'}`}
          </span>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded-full text-[11px] whitespace-nowrap transition-colors flex-shrink-0"
              style={{
                background: filter === f ? 'rgba(200,242,90,0.12)' : 'rgba(255,255,255,0.04)',
                border: filter === f ? '1px solid rgba(200,242,90,0.3)' : '1px solid rgba(255,255,255,0.07)',
                color: filter === f ? '#C8F25A' : 'rgba(255,255,255,0.45)',
                fontFamily: "'DM Mono', monospace",
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Match list */}
        {failed ? (
          <LoadError what="your matches" onRetry={retry} retrying={loading} />
        ) : loading ? (
          <p className="text-white/35 text-sm mt-4">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-white/35 text-sm mt-4">No matches found.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map(m => (
              <MatchCard
                key={m.id}
                opponent={m.opponent ? `vs ${m.opponent}` : m.competition || 'Match'}
                date={m.match_date || m.created_at}
                scoreUs={m.team_score}
                scoreThem={m.opponent_score}
                competition={m.competition}
                band={scoreToBand(m.computed_rating ?? 6.5)}
                onClick={() => navigate(`/player/match/${m.id}`)}
              />
            ))}
          </div>
        )}

        {/* Load more */}
        {hasMore && filter === 'All' && !failed && (
          <>
            {pageFailed && (
              <p className="mt-4 text-[11px] text-white/45 text-center leading-relaxed" role="alert">
                Couldn't load the next matches. Nothing is missing from your record —
                tap again to retry.
              </p>
            )}
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full mt-2 py-3 rounded-[12px] text-[11px] tracking-[0.08em] uppercase text-white/45 border border-white/[0.07] bg-transparent active:bg-white/[0.04] transition-colors disabled:opacity-40"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {loadingMore ? 'Loading…' : pageFailed ? 'Retry' : 'Load more'}
            </button>
          </>
        )}

        {/* J6: the training the coach logged (TRAK-76). */}
        {user && <TrainingHistory playerUserId={user.id} reloadOn={user} />}
      </div>
      <NavBar role="player" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
