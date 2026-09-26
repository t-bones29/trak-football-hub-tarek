import { useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { MobileShell, NavBar, MetadataLabel } from '@/components/trak'
import { ParentChildSelector, ParentFamilyContent, ParentLoadError, ParentLoading, ParentRating } from '@/components/parent/ParentFamily'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { useChildrenAwaitingConsent, useParentDevelopment, useParentMatches } from '@/hooks/useParentData'
import { averageRecordedRating, formatParentAward, formatParentDate, matchResult } from '@/lib/parent-data'
import { BANDS } from '@/lib/types'
import { scoreToBand } from '@/lib/rating-engine'
import { trackEvent } from '@/lib/telemetry'

export default function ParentHome() {
  const navigate = useNavigate()
  const location = useLocation()
  const { selectedChild } = useParentChildren()
  const matchQuery = useParentMatches()
  const developmentQuery = useParentDevelopment()
  const consentQuery = useChildrenAwaitingConsent()
  const matches = matchQuery.data ?? []
  const development = developmentQuery.data
  const assessment = development?.assessments[0]
  const award = development?.awards[0]
  const details = development?.details
  const hasError = matchQuery.isError || developmentQuery.isError
  const loading = matchQuery.isPending || developmentQuery.isPending

  // J7 (TRAK-10): parents never see the coach's message (TRAK-63), so a parent
  // open is the child's latest assessment reaching this screen. The pilot view
  // counts each parent and assessment once and checks the parent's link.
  const shownAssessmentId = selectedChild && !loading && !hasError ? assessment?.id : undefined
  useEffect(() => {
    if (shownAssessmentId) void trackEvent('assessment_viewed', { assessment_id: shownAssessmentId })
  }, [shownAssessmentId])

  return (
    <MobileShell>
      <div className="pt-3 pb-4">
        <h1 className="text-xl text-foreground mb-5">Home</h1>
        {consentQuery.isError ? (
          <ParentLoadError message="Couldn't check pending approvals." onRetry={() => { void consentQuery.refetch() }} />
        ) : (consentQuery.data?.length ?? 0) > 0 && (
          <button onClick={() => navigate('/parent/consent')}
            className="w-full text-left rounded-xl border border-primary/30 bg-primary/10 p-4 mb-4">
            <p className="text-sm text-foreground">
              {consentQuery.data!.map(child => child.full_name).join(', ')} {consentQuery.data!.length === 1 ? 'is' : 'are'} waiting on your approval
            </p>
            <p className="text-xs text-muted-foreground mt-1">Review your children's pending approvals.</p>
          </button>
        )}
        <ParentChildSelector />
        <ParentFamilyContent>
          {hasError ? <ParentLoadError onRetry={() => { void matchQuery.refetch(); void developmentQuery.refetch() }} />
            : loading ? <ParentLoading /> : (
              <>
                <div className="pb-5">
                  <h2 className="text-2xl font-light text-foreground">{selectedChild?.name}</h2>
                  {details && <p className="text-xs text-muted-foreground mt-2">
                    {[details.position, details.current_club, details.age_group].filter(Boolean).join(' · ')}
                  </p>}
                </div>
                {matches.length > 0 && (
                  <section className="rounded-xl p-5 mb-4 bg-card border border-border" aria-label="Recorded matches summary">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <MetadataLabel text="RECORDED MATCHES" />
                        <div className="mt-3"><ParentRating rating={averageRecordedRating(matches)} /></div>
                      </div>
                      <div className="text-right"><MetadataLabel text="MATCHES" /><p className="text-3xl font-light mt-2 text-foreground">{matches.length}</p></div>
                    </div>
                    <div className="flex gap-5 pt-4 mt-4 border-t border-border">
                      {(['W', 'D', 'L'] as const).map(result => <div key={result} className="text-sm text-foreground">
                        {matches.filter(match => matchResult(match) === result).length} <span className="text-muted-foreground">{result}</span>
                      </div>)}
                    </div>
                  </section>
                )}
                <section className="mt-5" aria-label="Latest coach assessment">
                  <MetadataLabel text="LATEST COACH ASSESSMENT" />
                  {assessment ? (
                    <div className="rounded-xl p-5 mt-2 bg-card border border-border">
                      <div className="flex items-center justify-between gap-2 mb-4">
                        <div>
                          <p className="text-sm text-foreground">{(assessment.coach_user_id && development?.coachNames[assessment.coach_user_id]) || 'Coach'}</p>
                          <p className="text-xs text-muted-foreground mt-1">{formatParentDate(assessment.created_at)}</p>
                        </div>
                        <ParentRating rating={assessment.coach_rating} missing="Not assessed" />
                      </div>
                      <div className="space-y-3">
                        {[
                          { label: 'Work Rate', score: assessment.work_rate },
                          { label: 'Tactical', score: assessment.tactical },
                          { label: 'Attitude', score: assessment.attitude },
                          { label: 'Technical', score: assessment.technical },
                          { label: 'Physical', score: assessment.physical },
                          { label: 'Coachability', score: assessment.coachability },
                        ].map(category => {
                          const rated = category.score != null && Number.isFinite(category.score)
                          const band = rated ? BANDS.find(item => item.word.toLowerCase() === scoreToBand(category.score)) : null
                          return <div key={category.label} className="flex items-center gap-3">
                            <span className="w-24 text-xs text-muted-foreground">{category.label}</span>
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden="true">
                              {rated && <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(10, category.score)) * 10}%`, backgroundColor: band?.color }} />}
                            </div>
                            <span className="text-xs w-20 text-right text-muted-foreground" style={band ? { color: band.color } : undefined}>{band?.word ?? 'Not assessed'}</span>
                          </div>
                        })}
                      </div>
                    </div>
                  ) : <p className="py-4 text-sm text-muted-foreground">No coach assessments yet.</p>}
                </section>
                {award && <section className="mt-5" aria-label="Recognition">
                  <MetadataLabel text="RECOGNITION" />
                  <div className="rounded-xl p-4 mt-2 bg-card border border-border">
                    <p className="text-sm text-foreground">{formatParentAward(award.award_type)}</p>
                    {award.awarded_for && <p className="text-xs text-muted-foreground mt-2">{award.awarded_for}</p>}
                    {award.note && <p className="text-sm text-foreground mt-2 italic">&ldquo;{award.note}&rdquo;</p>}
                    <p className="text-xs text-muted-foreground mt-2">{formatParentDate(award.created_at)}</p>
                  </div>
                </section>}
                <section className="mt-5" aria-label="Recent matches">
                  <MetadataLabel text="RECENT MATCHES" />
                  {matches.length ? <div className="rounded-xl mt-2 bg-card border border-border divide-y divide-border">
                    {matches.slice(0, 5).map(match => <Link key={match.id} to={`/parent/match/${match.id}`} className="flex items-center gap-3 p-4">
                      <span className="w-5 text-xs text-muted-foreground">{matchResult(match) ?? '—'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{match.opponent || match.competition || 'Match'}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatParentDate(match.match_date ?? match.created_at)} · {matchResult(match) ? `${match.team_score}–${match.opponent_score}` : 'Score not recorded'}
                        </p>
                      </div>
                      <ParentRating rating={match.computed_rating} />
                    </Link>)}
                  </div> : <p className="py-4 text-sm text-muted-foreground">No matches yet. Matches recorded by the coach will appear here.</p>}
                </section>
              </>
            )}
        </ParentFamilyContent>
      </div>
      <NavBar role="parent" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
