import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { Button } from '@/components/ui/button'
import { consentRequest, hasOwnConsent, withdrawOwnConsent } from '@/lib/parent-consent-withdrawal'

type State = 'loading' | 'active' | 'confirm' | 'writing' | 'none' | 'done' | 'read-error' | 'write-error'

function ChildConsent({ parentId, childId, childName }: { parentId: string; childId: string; childName: string }) {
  const cache = useQueryClient()
  const [state, setState] = useState<State>('loading')
  const current = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const writing = useRef(false)
  const read = useCallback(async () => {
    current.current?.abort()
    const request = new AbortController()
    current.current = request
    setState('loading')
    try {
      const active = await consentRequest(request, () => hasOwnConsent(parentId, childId, request.signal))
      if (mounted.current && current.current === request) setState(active ? 'active' : 'none')
    } catch {
      if (mounted.current && current.current === request) setState('read-error')
    }
  }, [parentId, childId])

  useEffect(() => {
    mounted.current = true
    void read()
    return () => { mounted.current = false; current.current?.abort() }
  }, [read])

  const withdraw = async () => {
    if (writing.current || state !== 'confirm') return
    writing.current = true
    current.current?.abort()
    const request = new AbortController()
    current.current = request
    setState('writing')
    try {
      await consentRequest(request, () => withdrawOwnConsent(parentId, childId, request.signal))
      if (mounted.current && current.current === request) setState('done')
    } catch {
      if (mounted.current && current.current === request) setState('write-error')
    } finally {
      // A lost response can still have committed. Drop the captured child's
      // data on either outcome; late reads must not repopulate its old cache.
      await cache.cancelQueries({ queryKey: ['parent', parentId, childId] })
      cache.removeQueries({ queryKey: ['parent', parentId, childId] })
      void cache.invalidateQueries({ queryKey: ['parent', parentId, 'awaiting-consent'] })
      writing.current = false
    }
  }

  return <section aria-label={`Consent for ${childName}`} className="rounded-xl border border-border bg-card p-4 space-y-3">
    <h2 className="text-base font-medium text-foreground">Consent for {childName}</h2>
    {state === 'loading' && <p role="status" className="text-sm text-muted-foreground">Checking consent…</p>}
    {state === 'active' && <>
      <p className="text-sm text-muted-foreground">You have an active approval for this child.</p>
      <Button variant="outline" className="min-h-11 h-auto whitespace-normal" onClick={() => setState('confirm')}>Withdraw consent for {childName}</Button>
    </>}
    {(state === 'confirm' || state === 'writing') && <>
      <p className="text-sm text-foreground">Withdraw your approval for {childName}? This does not delete their account or past records. It does not withdraw another guardian’s approval.</p>
      <div className="flex flex-col gap-2">
        <Button variant="outline" className="min-h-11 h-auto whitespace-normal border-destructive hover:bg-destructive/10" disabled={state === 'writing'} onClick={() => { void withdraw() }}>
          {state === 'writing' ? 'Withdrawing…' : `Confirm withdrawal for ${childName}`}
        </Button>
        <Button variant="outline" className="min-h-11" disabled={state === 'writing'} onClick={() => setState('active')}>Keep consent</Button>
      </div>
    </>}
    {state === 'none' && <p role="status" className="text-sm text-muted-foreground">You have no active consent recorded for {childName}.</p>}
    {state === 'done' && <p role="status" className="text-sm text-foreground">Your consent for {childName} has been withdrawn.</p>}
    {(state === 'read-error' || state === 'write-error') && <>
      <p role="alert" className="text-sm text-foreground">{state === 'write-error'
        ? "Couldn't confirm whether your consent was withdrawn. Check its status before trying again."
        : "Couldn't check your consent. Check your connection and try again."}</p>
      <Button variant="outline" className="min-h-11" onClick={() => { void read() }}>Check consent status</Button>
    </>}
  </section>
}

export function ParentConsentWithdrawal() {
  const { parentId, selectedChild } = useParentChildren()
  if (!parentId || !selectedChild) return null
  return <ChildConsent key={`${parentId}:${selectedChild.id}`} parentId={parentId} childId={selectedChild.id} childName={selectedChild.name} />
}
