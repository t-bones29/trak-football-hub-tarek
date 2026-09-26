import PlayerMatchDetail from '@/pages/player/PlayerMatchDetail'
import { useChildrenAwaitingConsent } from '@/hooks/useParentData'

/* TRAK-73: the player's match detail inside the parent app. A child still
   awaiting this parent's approval shows only what the parent already saw on
   their list; while the approval list loads, or if it can't be read, the view
   stays limited (fails closed). */
export default function ParentMatchDetail() {
  const awaiting = useChildrenAwaitingConsent()
  const waiting = new Set(awaiting.data?.map(child => child.player_user_id))
  return <PlayerMatchDetail role="parent"
    limitedFor={childId => !awaiting.isSuccess || waiting.has(childId.toLowerCase())} />
}
