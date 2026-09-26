import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell } from '@/components/trak'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { fetchAwaitingConsent, recordParentApproval, type AwaitingConsentChild } from '@/lib/parent-consent'
import {
  CONSENT_PURPOSES,
  CONSENT_STATEMENT,
  CONSENT_THRESHOLD_AGE,
  type ConsentPurposeKey,
} from '@/lib/consent'

interface ApprovalDraft {
  childId: string
  relationship: 'parent' | 'legal_guardian'
  optional: Partial<Record<ConsentPurposeKey, boolean>>
  confirmed: boolean
}

/**
 * Existing parent approval journey. Server policy determines which records
 * require approval; this screen retains the current notice and purpose choices.
 *
 * Keep these properties when evolving the academy-specific consent flow:
 *   - separate choices, never one bundled yes
 *   - optional choices default to off, and are not pre-ticked
 *   - the exact wording shown is what gets stored, so a past consent can be
 *     reconstructed against the text the parent actually read
 */
function ParentConsentAccount({ parentId }: { parentId: string }) {
  const navigate = useNavigate()
  const [children, setChildren] = useState<AwaitingConsentChild[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [savedFor, setSavedFor] = useState<string | null>(null)
  const [draft, setDraft] = useState<ApprovalDraft | null>(null)
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null)
  const mounted = useRef(false)
  const reading = useRef<AbortController | null>(null)
  const writing = useRef<AbortController | null>(null)
  const submittingNow = useRef(false)
  const finishAfterRefresh = useRef(false)

  const load = useCallback(async () => {
    reading.current?.abort()
    const request = new AbortController()
    reading.current = request
    setLoading(true)
    setLoadError(null)
    try {
      const pending = await fetchAwaitingConsent(request.signal)
      if (!mounted.current || reading.current !== request) return
      setChildren(pending)
      setLoading(false)
      // A successful refresh, not a stale pre-save count, determines completion.
      if (finishAfterRefresh.current && pending.length === 0) {
        finishAfterRefresh.current = false
        navigate('/parent/home', { replace: true })
      }
    } catch {
      if (!mounted.current || reading.current !== request || request.signal.aborted) return
      setLoadError("Couldn't load pending approvals. Check your connection and try again.")
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
      reading.current?.abort()
      writing.current?.abort()
    }
  }, [load])

  const child = children.find(item => item.player_user_id === selectedChildId) ?? children[0] ?? null
  const currentDraft: ApprovalDraft = draft?.childId === child?.player_user_id && draft
    ? draft
    : { childId: child?.player_user_id ?? '', relationship: 'parent', optional: {}, confirmed: false }
  const { relationship, optional, confirmed } = currentDraft
  const updateDraft = (change: Partial<Omit<ApprovalDraft, 'childId'>>) => {
    setDraft({ ...currentDraft, ...change })
  }

  const handleSubmit = async () => {
    if (!child || !confirmed || submittingNow.current) return
    submittingNow.current = true
    const request = new AbortController()
    writing.current = request
    setSubmitting(true)
    setSavedFor(null)
    try {
      const purposes = CONSENT_PURPOSES.reduce<Record<ConsentPurposeKey, boolean>>((acc, purpose) => {
        acc[purpose.key] = purpose.required || Boolean(optional[purpose.key])
        return acc
      }, {} as Record<ConsentPurposeKey, boolean>)
      await recordParentApproval(parentId, { playerUserId: child.player_user_id, relationship, purposes }, request.signal)
      if (!mounted.current || request.signal.aborted) return
      setSavedFor(child.full_name)
      setDraft(null)
      finishAfterRefresh.current = true
      await load()
    } catch {
      if (!mounted.current || request.signal.aborted) return
      // A lost/invalid response does not prove that the server rejected the
      // write. Recheck authoritative state before offering another submission.
      finishAfterRefresh.current = false
      setLoadError("Couldn't confirm whether your approval was saved. Check its status before trying again.")
      setLoading(false)
    } finally {
      submittingNow.current = false
      if (writing.current === request) writing.current = null
      if (mounted.current) setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <MobileShell>
        <div className="p-6 text-muted-foreground text-sm">Loading…</div>
      </MobileShell>
    )
  }

  if (loadError) {
    return (
      <MobileShell>
        <div className="p-6">
          {savedFor && <p role="status" className="text-sm text-foreground mb-2">Approval saved for {savedFor}.</p>}
          <p role="alert" className="text-sm text-foreground mb-4">{loadError}</p>
          <Button onClick={() => { void load() }} variant="outline">Retry</Button>
        </div>
      </MobileShell>
    )
  }

  if (!child) {
    return (
      <MobileShell>
        <div className="p-6">
          <p className="text-sm text-foreground mb-2">Nothing to approve</p>
          <p className="text-xs text-muted-foreground mb-4">
            None of your children are waiting on your approval.
          </p>
          <Button onClick={() => navigate('/parent/home')} variant="outline">Go to home</Button>
        </div>
      </MobileShell>
    )
  }

  const firstName = child.full_name.split(' ')[0]

  return (
    <MobileShell>
      <div className="px-6 py-8 flex flex-col gap-5">
        {savedFor && <p role="status" className="text-sm text-muted-foreground">Approval saved for {savedFor}.</p>}
        {children.length > 1 && (
          <div>
            <label htmlFor="approval-child" className="block text-sm text-muted-foreground mb-2">Child to approve</label>
            <select id="approval-child" value={child.player_user_id} disabled={submitting}
              onChange={event => {
                if (submittingNow.current) return
                setSelectedChildId(event.target.value)
                setDraft(null)
                setSavedFor(null)
              }}
              className="w-full min-h-11 rounded-xl border border-border bg-card px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-primary">
              {children.map(item => (
                <option key={item.player_user_id} value={item.player_user_id}>{item.full_name} · Age {item.age_years}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <h1 className="text-2xl text-foreground mb-1 break-words">Approve {child.full_name}'s account</h1>
          <p className="text-sm text-muted-foreground">
            {firstName} is {child.age_years}. Under {CONSENT_THRESHOLD_AGE}, a parent or guardian
            has to approve before their coach can record anything about them.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Your relationship</p>
          <div className="flex gap-2">
            {([['parent', 'Parent'], ['legal_guardian', 'Legal guardian']] as const).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={relationship === value ? 'default' : 'outline'}
                onClick={() => updateDraft({ relationship: value })}
                disabled={submitting}
                className="flex-1"
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">What you're approving</p>
          {CONSENT_PURPOSES.map(purpose => (
            <div key={purpose.key} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id={purpose.key}
                  checked={purpose.required ? true : Boolean(optional[purpose.key])}
                  disabled={purpose.required || submitting}
                  onCheckedChange={checked =>
                    updateDraft({ optional: { ...optional, [purpose.key]: checked === true } })
                  }
                  className="mt-0.5"
                />
                <label htmlFor={purpose.key} className="flex-1 cursor-pointer">
                  <span className="block text-sm text-foreground">{purpose.label}</span>
                  <span className="block text-xs text-muted-foreground mt-1">{purpose.detail}</span>
                  {purpose.required && (
                    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mt-2">
                      Required — this is what the app does
                    </span>
                  )}
                </label>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Saying no to the optional ones does not affect {firstName}'s place at the academy or
            how their coach treats them.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="confirm"
              checked={confirmed}
              onCheckedChange={checked => updateDraft({ confirmed: checked === true })}
              disabled={submitting}
              className="mt-0.5"
            />
            <label htmlFor="confirm" className="text-xs text-muted-foreground cursor-pointer">
              {CONSENT_STATEMENT}
            </label>
          </div>
        </div>

        <Button onClick={handleSubmit} disabled={submitting || !confirmed} className="w-full min-h-11 h-auto py-2 whitespace-normal break-words">
          {submitting ? 'Saving…' : `Approve ${child.full_name}'s account`}
        </Button>
      </div>
    </MobileShell>
  )
}

export default function ParentConsent() {
  const { user } = useAuth()
  // Account changes remount the state machine; token refreshes do not erase
  // the current parent's choices. Old promises retain an unmounted instance.
  return user
    ? <ParentConsentAccount key={user.id} parentId={user.id} />
    : <MobileShell><div className="p-6 text-muted-foreground text-sm">Loading…</div></MobileShell>
}
