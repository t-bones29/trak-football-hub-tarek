import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { Database } from '@/integrations/supabase/types'
import type { MyTask } from '@/lib/tasks'

/* TRAK-601 (coach–player P13): the squad's training plans as the player reads them, through my_training_plans(): no
   coaching points, no coach's note, and nothing where the academy has tasks off. */
export type PlanPractice = Database['public']['Functions']['my_training_plans']['Returns'][number]

/** The trainings that have a plan: by event id, and by the register taken for them (a past training's session id).
 *  One row per plan (its first practice), ids only. */
export function usePlansReady() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['player', 'plans-ready', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_training_plans').select('event_id, session_id').eq('position', 1)
      if (error) throw error
      const rows = data ?? []
      return {
        events: new Set(rows.map(row => row.event_id)),
        bySession: new Map(rows.flatMap(row => (row.session_id ? [[row.session_id, row.event_id] as const] : []))),
      }
    },
  })
}

/** One training's plan, in order; empty when it has none. Null (not a training) reads nothing. */
export function usePlayerPlan(eventId: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['player', 'plan', user?.id, eventId],
    enabled: !!user && !!eventId,
    queryFn: async (): Promise<PlanPractice[]> => {
      const { data, error } = await supabase.rpc('my_training_plans').eq('event_id', eventId!).order('position')
      if (error) throw error
      return data ?? []
    },
  })
}

/** "What we're working on" (not "Today": the plan shows before and after the day too): the plan's parts, once each, in order. */
export const workingOn = (plan: PlanPractice[]) => [...new Set(plan.map(p => p.part || p.name))].join(' · ')

/** The plan's Got it, when the player has one to give or take back. */
export const planTask = (tasks: MyTask[] | undefined, eventId: string) =>
  tasks?.find(t => t.source_type === 'training_plan' && t.source_id === eventId)
