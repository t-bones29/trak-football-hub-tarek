import { Link, useNavigate, useLocation } from 'react-router-dom'
import { MobileShell, NavBar } from '@/components/trak'
import { ParentChildSelector, ParentFamilyContent, ParentLoadError, ParentLoading, ParentRating } from '@/components/parent/ParentFamily'
import { useParentMatches } from '@/hooks/useParentData'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { TrainingHistory } from '@/components/player/TrainingHistory'
import { formatParentDate, matchResult } from '@/lib/parent-data'

export default function ParentMatches() {
  const navigate = useNavigate()
  const location = useLocation()
  const query = useParentMatches()
  const matches = query.data ?? []
  const { selectedChild } = useParentChildren()
  return (
    <MobileShell>
      <div className="pt-3 pb-4">
        <h1 className="text-xl text-foreground mb-5">Matches</h1>
        <ParentChildSelector />
        <ParentFamilyContent>
          {query.isError ? <ParentLoadError message="Couldn't load matches." onRetry={() => { void query.refetch() }} />
            : query.isPending ? <ParentLoading />
              : matches.length === 0 ? <p className="text-sm text-muted-foreground text-center py-12">No matches yet.</p>
                : <div className="divide-y divide-border">
                  {matches.map(match => <Link key={match.id} to={`/parent/match/${match.id}`} className="flex items-center gap-3 py-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{match.opponent || match.competition || 'Match'}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {[formatParentDate(match.match_date ?? match.created_at), match.competition, match.venue].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <ParentRating rating={match.computed_rating} />
                      <p className="text-xs text-muted-foreground mt-1">{matchResult(match)
                        ? `${matchResult(match)} ${match.team_score}–${match.opponent_score}` : 'Score not recorded'}</p>
                    </div>
                  </Link>)}
                </div>}
          {/* J6 (TRAK-77): the training the coach logged for this child. */}
          {selectedChild && <TrainingHistory playerUserId={selectedChild.id}
            waitingText="Training appears once you approve this child." />}
        </ParentFamilyContent>
      </div>
      <NavBar role="parent" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
