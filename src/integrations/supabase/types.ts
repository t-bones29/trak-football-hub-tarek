export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      admin_notes: {
        Row: {
          admin_user_id: string
          created_at: string
          id: string
          note: string
          organization_id: string
          target_coach_user_id: string | null
          target_squad_player_id: string | null
          target_type: string
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          id?: string
          note: string
          organization_id: string
          target_coach_user_id?: string | null
          target_squad_player_id?: string | null
          target_type: string
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          id?: string
          note?: string
          organization_id?: string
          target_coach_user_id?: string | null
          target_squad_player_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      objective_progress: {
        Row: { evaluation_id: string; player_objective_id: string; status: string }
        Insert: { evaluation_id: string; player_objective_id: string; status: string }
        Update: { evaluation_id?: string; player_objective_id?: string; status?: string }
        Relationships: [
          {
            foreignKeyName: "objective_progress_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "season_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "objective_progress_player_objective_id_fkey"
            columns: ["player_objective_id"]
            isOneToOne: false
            referencedRelation: "player_objectives"
            referencedColumns: ["id"]
          },
        ]
      }
      objective_stuck_choices: {
        Row: {
          after_evaluation_id: string
          choice: string
          chosen_at: string
          chosen_by: string | null
          id: string
          new_objective_id: string | null
          player_objective_id: string
        }
        Insert: {
          after_evaluation_id: string
          choice: string
          chosen_at?: string
          chosen_by?: string | null
          id?: string
          new_objective_id?: string | null
          player_objective_id: string
        }
        Update: {
          after_evaluation_id?: string
          choice?: string
          chosen_at?: string
          chosen_by?: string | null
          id?: string
          new_objective_id?: string | null
          player_objective_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "objective_stuck_choices_after_evaluation_id_fkey"
            columns: ["after_evaluation_id"]
            isOneToOne: false
            referencedRelation: "season_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "objective_stuck_choices_new_objective_id_fkey"
            columns: ["new_objective_id"]
            isOneToOne: false
            referencedRelation: "player_objectives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "objective_stuck_choices_player_objective_id_fkey"
            columns: ["player_objective_id"]
            isOneToOne: false
            referencedRelation: "player_objectives"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          admin_user_id: string
          created_at: string
          id: string
          join_code: string
          logo_url: string | null
          name: string
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          id?: string
          join_code: string
          logo_url?: string | null
          name: string
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          id?: string
          join_code?: string
          logo_url?: string | null
          name?: string
        }
        Relationships: []
      }
      pilot_config: {
        Row: {
          created_at: string
          id: boolean
          org_id: string | null
          starts_on: string
          weeks: number
        }
        Insert: {
          created_at?: string
          id?: boolean
          org_id?: string | null
          starts_on: string
          weeks?: number
        }
        Update: {
          created_at?: string
          id?: boolean
          org_id?: string | null
          starts_on?: string
          weeks?: number
        }
        Relationships: []
      }
      staff_compliance: {
        Row: {
          coach_user_id: string
          dbs_expiry: string | null
          dbs_status: string | null
          first_aid_expiry: string | null
          id: string
          license_expiry: string | null
          license_level: string | null
          notes: string | null
          organization_id: string
          safeguarding_completed: boolean
          updated_at: string
        }
        Insert: {
          coach_user_id: string
          dbs_expiry?: string | null
          dbs_status?: string | null
          first_aid_expiry?: string | null
          id?: string
          license_expiry?: string | null
          license_level?: string | null
          notes?: string | null
          organization_id: string
          safeguarding_completed?: boolean
          updated_at?: string
        }
        Update: {
          coach_user_id?: string
          dbs_expiry?: string | null
          dbs_status?: string | null
          first_aid_expiry?: string | null
          id?: string
          license_expiry?: string | null
          license_level?: string | null
          notes?: string | null
          organization_id?: string
          safeguarding_completed?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      telemetry_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json
          role: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          role?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          role?: string | null
          user_id?: string
        }
        Relationships: []
      }
      coach_assessment_notes: {
        Row: {
          assessment_id: string
          coach_user_id: string
          created_at: string
          id: string
          note: string
        }
        Insert: {
          assessment_id: string
          coach_user_id: string
          created_at?: string
          id?: string
          note: string
        }
        Update: {
          assessment_id?: string
          coach_user_id?: string
          created_at?: string
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_assessment_notes_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: true
            referencedRelation: "coach_assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_assessments: {
        Row: {
          appearance: string | null
          attitude: number
          coach_name_snapshot: string | null
          coach_rating: number | null
          coach_user_id: string
          coachability: number
          consistency: number
          created_at: string | null
          evaluation_id: string | null
          flag: string | null
          id: string
          impact: number
          organization_id: string | null
          physical: number
          published_at: string | null
          private_note: string | null
          session_id: string | null
          spirit: number
          squad_player_id: string
          tactical: number
          technical: number
          technique: number
          work_rate: number
          workrate: number
        }
        Insert: {
          appearance?: string | null
          attitude?: number
          coach_name_snapshot?: string | null
          coach_rating?: number | null
          coach_user_id: string
          coachability?: number
          consistency?: number
          created_at?: string | null
          evaluation_id?: string | null
          flag?: string | null
          id?: string
          impact?: number
          organization_id?: string | null
          physical?: number
          published_at?: string | null
          private_note?: string | null
          session_id?: string | null
          spirit?: number
          squad_player_id: string
          tactical?: number
          technical?: number
          technique?: number
          work_rate?: number
          workrate?: number
        }
        Update: {
          appearance?: string | null
          attitude?: number
          coach_name_snapshot?: string | null
          coach_rating?: number | null
          coach_user_id?: string
          coachability?: number
          consistency?: number
          created_at?: string | null
          evaluation_id?: string | null
          flag?: string | null
          id?: string
          impact?: number
          organization_id?: string | null
          physical?: number
          published_at?: string | null
          private_note?: string | null
          session_id?: string | null
          spirit?: number
          squad_player_id?: string
          tactical?: number
          technical?: number
          technique?: number
          work_rate?: number
          workrate?: number
        }
        Relationships: [
          {
            foreignKeyName: "coach_assessments_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "season_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_assessments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "coach_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_assessments_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_calendar_events: {
        Row: {
          cancel_reason: string | null
          coach_user_id: string
          competition: string | null
          created_at: string
          ends_at: string | null
          end_time: string | null
          event_date: string | null
          squad: string | null
          start_time: string | null
          event_type: string
          home_away: string | null
          id: string
          kit: string | null
          kit_snapshot: Json | null
          family_note: string | null
          training_themes: string[]
          meet_time: string | null
          notes: string | null
          opponent: string | null
          organization_id: string | null
          published: boolean
          sequence: number
          series_id: string | null
          source: string
          starts_at: string
          status: string
          title: string
          updated_at: string
          venue: string | null
        }
        Insert: {
          cancel_reason?: string | null
          coach_user_id: string
          competition?: string | null
          created_at?: string
          ends_at?: string | null
          end_time?: string | null
          event_date?: string | null
          squad?: string | null
          start_time?: string | null
          event_type?: string
          home_away?: string | null
          id?: string
          kit?: string | null
          kit_snapshot?: Json | null
          family_note?: string | null
          training_themes?: string[]
          meet_time?: string | null
          notes?: string | null
          opponent?: string | null
          organization_id?: string | null
          published?: boolean
          sequence?: number
          series_id?: string | null
          source?: string
          starts_at: string
          status?: string
          title: string
          updated_at?: string
          venue?: string | null
        }
        Update: {
          cancel_reason?: string | null
          coach_user_id?: string
          competition?: string | null
          created_at?: string
          ends_at?: string | null
          end_time?: string | null
          event_date?: string | null
          squad?: string | null
          start_time?: string | null
          event_type?: string
          home_away?: string | null
          id?: string
          kit?: string | null
          kit_snapshot?: Json | null
          family_note?: string | null
          training_themes?: string[]
          meet_time?: string | null
          notes?: string | null
          opponent?: string | null
          organization_id?: string | null
          published?: boolean
          sequence?: number
          series_id?: string | null
          source?: string
          starts_at?: string
          status?: string
          title?: string
          updated_at?: string
          venue?: string | null
        }
        Relationships: []
      }
      coach_team_kits: {
        Row: {
          id: string
          coach_user_id: string
          organization_id: string
          squad: string
          kits: Json
          updated_at: string
        }
        Insert: {
          id?: string
          coach_user_id: string
          organization_id?: string
          squad?: string
          kits: Json
          updated_at?: string
        }
        Update: {
          id?: string
          coach_user_id?: string
          organization_id?: string
          squad?: string
          kits?: Json
          updated_at?: string
        }
        Relationships: [{
          foreignKeyName: "coach_team_kits_organization_id_fkey"
          columns: ["organization_id"]
          isOneToOne: false
          referencedRelation: "organizations"
          referencedColumns: ["id"]
        }]
      }
      coach_drill_bookmarks: {
        Row: {
          coach_user_id: string
          created_at: string
          drill: string
        }
        Insert: {
          coach_user_id?: string
          created_at?: string
          drill: string
        }
        Update: {
          coach_user_id?: string
          created_at?: string
          drill?: string
        }
        Relationships: []
      }
      coach_drills: {
        Row: {
          group_size: number | null
          part_type: string | null
          players_kind: string | null
          area: string
          coach_user_id: string
          conditions: string
          created_at: string
          direction: string
          how: string
          id: string
          minutes: number
          name: string
          numbers: string
          targets: string
          tell: string
          updated_at: string
        }
        Insert: {
          group_size?: number | null
          part_type?: string | null
          players_kind?: string | null
          area?: string
          coach_user_id?: string
          conditions?: string
          created_at?: string
          direction?: string
          how?: string
          id?: string
          minutes: number
          name: string
          numbers?: string
          targets?: string
          tell?: string
          updated_at?: string
        }
        Update: {
          group_size?: number | null
          part_type?: string | null
          players_kind?: string | null
          area?: string
          coach_user_id?: string
          conditions?: string
          created_at?: string
          direction?: string
          how?: string
          id?: string
          minutes?: number
          name?: string
          numbers?: string
          targets?: string
          tell?: string
          updated_at?: string
        }
        Relationships: []
      }
      coach_details: {
        Row: {
          coach_role: string | null
          created_at: string | null
          current_club: string | null
          id: string
          organization_id: string | null
          team: string | null
          user_id: string
        }
        Insert: {
          coach_role?: string | null
          created_at?: string | null
          current_club?: string | null
          id?: string
          organization_id?: string | null
          team?: string | null
          user_id: string
        }
        Update: {
          coach_role?: string | null
          created_at?: string | null
          current_club?: string | null
          id?: string
          organization_id?: string | null
          team?: string | null
          user_id?: string
        }
        Relationships: []
      }
      coach_home_order: {
        Row: {
          coach_user_id: string
          day: string
          item_keys: string[]
          squad_view: string
          updated_at: string
        }
        Insert: {
          coach_user_id?: string
          day: string
          item_keys: string[]
          squad_view: string
          updated_at?: string
        }
        Update: {
          coach_user_id?: string
          day?: string
          item_keys?: string[]
          squad_view?: string
          updated_at?: string
        }
        Relationships: []
      }
      coach_sessions: {
        Row: {
          coach_user_id: string
          event_id: string | null
          competition: string | null
          created_at: string | null
          id: string
          notes: string | null
          session_date: string | null
          session_type: string
          squad: string | null
          title: string
          training_type: string | null
          venue: string | null
        }
        Insert: {
          coach_user_id: string
          event_id?: string | null
          competition?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          session_date?: string | null
          session_type?: string
          squad?: string | null
          title: string
          training_type?: string | null
          venue?: string | null
        }
        Update: {
          coach_user_id?: string
          event_id?: string | null
          competition?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          session_date?: string | null
          session_type?: string
          squad?: string | null
          title?: string
          training_type?: string | null
          venue?: string | null
        }
        Relationships: []
      }
      coach_todos: {
        Row: {
          calendar_event_id: string | null
          coach_user_id: string
          created_at: string
          done_at: string | null
          due_on: string
          id: string
          title: string
          updated_at: string
          urgent: boolean
        }
        Insert: {
          calendar_event_id?: string | null
          coach_user_id?: string
          created_at?: string
          done_at?: string | null
          due_on: string
          id?: string
          title: string
          updated_at?: string
          urgent?: boolean
        }
        Update: {
          calendar_event_id?: string | null
          coach_user_id?: string
          created_at?: string
          done_at?: string | null
          due_on?: string
          id?: string
          title?: string
          updated_at?: string
          urgent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "coach_todos_calendar_event_id_fkey"
            columns: ["calendar_event_id"]
            isOneToOne: false
            referencedRelation: "coach_calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_absences: {
        Row: {
          event_id: string
          reason: string | null
          reported_at: string
          reported_by: string
          squad_player_id: string
        }
        Insert: {
          event_id: string
          reason?: string | null
          reported_at?: string
          reported_by: string
          squad_player_id: string
        }
        Update: {
          event_id?: string
          reason?: string | null
          reported_at?: string
          reported_by?: string
          squad_player_id?: string
        }
        Relationships: []
      }
      event_confirmations: {
        Row: {
          confirmed_at: string
          confirmed_by: string
          event_id: string
          squad_player_id: string
        }
        Insert: {
          confirmed_at?: string
          confirmed_by: string
          event_id: string
          squad_player_id: string
        }
        Update: {
          confirmed_at?: string
          confirmed_by?: string
          event_id?: string
          squad_player_id?: string
        }
        Relationships: []
      }
      notification_settings: {
        Row: {
          cant_make_it_alerts: boolean
          event_reminders: boolean
          needs_you: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          cant_make_it_alerts?: boolean
          event_reminders?: boolean
          needs_you?: boolean
          updated_at?: string
          user_id?: string
        }
        Update: {
          cant_make_it_alerts?: boolean
          event_reminders?: boolean
          needs_you?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      formation_copies: {
        Row: {
          by_default: boolean
          copied_at: string
          event_id: string
          formation_id: string
          not_coming: number
          skipped: number
        }
        Insert: {
          by_default?: boolean
          copied_at?: string
          event_id: string
          formation_id: string
          not_coming: number
          skipped: number
        }
        Update: {
          by_default?: boolean
          copied_at?: string
          event_id?: string
          formation_id?: string
          not_coming?: number
          skipped?: number
        }
        Relationships: [
          {
            foreignKeyName: "formation_copies_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "coach_calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formation_copies_formation_id_fkey"
            columns: ["formation_id"]
            isOneToOne: false
            referencedRelation: "formations"
            referencedColumns: ["id"]
          },
        ]
      }
      formation_players: {
        Row: {
          formation_id: string
          slot: number
          squad_player_id: string
        }
        Insert: {
          formation_id: string
          slot: number
          squad_player_id: string
        }
        Update: {
          formation_id?: string
          slot?: number
          squad_player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "formation_players_formation_id_fkey"
            columns: ["formation_id"]
            isOneToOne: false
            referencedRelation: "formations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formation_players_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      formations: {
        Row: {
          coach_user_id: string
          created_at: string
          format: number
          id: string
          is_default: boolean
          name: string
          shape: string
          squad: string
          updated_at: string
        }
        Insert: {
          coach_user_id: string
          created_at?: string
          format: number
          id?: string
          is_default?: boolean
          name: string
          shape: string
          squad: string
          updated_at?: string
        }
        Update: {
          coach_user_id?: string
          created_at?: string
          format?: number
          id?: string
          is_default?: boolean
          name?: string
          shape?: string
          squad?: string
          updated_at?: string
        }
        Relationships: []
      }
      game_evaluation_notes: {
        Row: {
          event_id: string
          note: string
          squad_player_id: string
        }
        Insert: {
          event_id: string
          note: string
          squad_player_id: string
        }
        Update: {
          event_id?: string
          note?: string
          squad_player_id?: string
        }
        Relationships: []
      }
      game_evaluation_players: {
        Row: {
          against_expectation: string | null
          did_job: string | null
          event_id: string
          played: boolean
          squad_player_id: string
          started_for: string | null
        }
        Insert: {
          against_expectation?: string | null
          did_job?: string | null
          event_id: string
          played: boolean
          squad_player_id: string
          started_for?: string | null
        }
        Update: {
          against_expectation?: string | null
          did_job?: string | null
          event_id?: string
          played?: boolean
          squad_player_id?: string
          started_for?: string | null
        }
        Relationships: []
      }
      game_evaluations: {
        Row: {
          event_id: string
          goals: Json
          how_they_scored: string
          our_score: number | null
          plan_worked: (string | null)[]
          published_at: string | null
          remind_at: string | null
          saved_at: string
          their_score: number | null
        }
        Insert: {
          event_id: string
          goals?: Json
          how_they_scored?: string
          our_score?: number | null
          plan_worked?: (string | null)[]
          published_at?: string | null
          remind_at?: string | null
          saved_at?: string
          their_score?: number | null
        }
        Update: {
          event_id?: string
          goals?: Json
          how_they_scored?: string
          our_score?: number | null
          plan_worked?: (string | null)[]
          published_at?: string | null
          remind_at?: string | null
          saved_at?: string
          their_score?: number | null
        }
        Relationships: []
      }
      game_for_family: {
        Row: {
          changed_at: string | null
          coach_name: string
          event_id: string
          has_note: boolean
          job: string
          role: string
          shared_at: string
          squad_player_id: string
        }
        Insert: {
          changed_at?: string | null
          coach_name?: string
          event_id: string
          has_note?: boolean
          job?: string
          role: string
          shared_at?: string
          squad_player_id: string
        }
        Update: {
          changed_at?: string | null
          coach_name?: string
          event_id?: string
          has_note?: boolean
          job?: string
          role?: string
          shared_at?: string
          squad_player_id?: string
        }
        Relationships: []
      }
      game_for_player: {
        Row: {
          changed_at: string | null
          event_id: string
          goals: Json
          job: string
          note: string
          shared_at: string
          squad_player_id: string
        }
        Insert: {
          changed_at?: string | null
          event_id: string
          goals?: Json
          job?: string
          note?: string
          shared_at?: string
          squad_player_id: string
        }
        Update: {
          changed_at?: string | null
          event_id?: string
          goals?: Json
          job?: string
          note?: string
          shared_at?: string
          squad_player_id?: string
        }
        Relationships: []
      }
      game_lineup_for_players: {
        Row: {
          event_id: string
          formation: string | null
          name: string
          role: string
          slot: number | null
          squad_player_id: string
        }
        Insert: {
          event_id: string
          formation?: string | null
          name: string
          role: string
          slot?: number | null
          squad_player_id: string
        }
        Update: {
          event_id?: string
          formation?: string | null
          name?: string
          role?: string
          slot?: number | null
          squad_player_id?: string
        }
        Relationships: []
      }
      game_plan_players: {
        Row: {
          context: string[]
          created_at: string
          event_id: string
          expectation: string
          job: string
          note: string
          role: string
          slot: number | null
          squad_player_id: string
          updated_at: string
        }
        Insert: {
          context?: string[]
          created_at?: string
          event_id: string
          expectation?: string
          job?: string
          note?: string
          role?: string
          slot?: number | null
          squad_player_id: string
          updated_at?: string
        }
        Update: {
          context?: string[]
          created_at?: string
          event_id?: string
          expectation?: string
          job?: string
          note?: string
          role?: string
          slot?: number | null
          squad_player_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      game_plans: {
        Row: {
          created_at: string
          event_id: string
          format: number
          formation: string | null
          goals: Json
          key_players: Json
          scouting: string
          strength: string | null
          their_formation: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          format?: number
          formation?: string | null
          goals?: Json
          key_players?: Json
          scouting?: string
          strength?: string | null
          their_formation?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          format?: number
          formation?: string | null
          goals?: Json
          key_players?: Json
          scouting?: string
          strength?: string | null
          their_formation?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      game_review_for_family: {
        Row: {
          against_expectation: string
          coach_name: string
          context: string[]
          did_job: string | null
          event_id: string
          expectation: string
          has_note: boolean
          job: string
          our_score: number
          published_at: string
          session_id: string | null
          squad_player_id: string
          their_score: number
        }
        Insert: {
          against_expectation: string
          coach_name?: string
          context?: string[]
          did_job?: string | null
          event_id: string
          expectation: string
          has_note?: boolean
          job?: string
          our_score: number
          published_at?: string
          session_id?: string | null
          squad_player_id: string
          their_score: number
        }
        Update: {
          against_expectation?: string
          coach_name?: string
          context?: string[]
          did_job?: string | null
          event_id?: string
          expectation?: string
          has_note?: boolean
          job?: string
          our_score?: number
          published_at?: string
          session_id?: string | null
          squad_player_id?: string
          their_score?: number
        }
        Relationships: []
      }
      game_review_for_player: {
        Row: {
          did_job: string | null
          event_id: string
          job: string
          note: string
          squad_player_id: string
        }
        Insert: {
          did_job?: string | null
          event_id: string
          job?: string
          note?: string
          squad_player_id: string
        }
        Update: {
          did_job?: string | null
          event_id?: string
          job?: string
          note?: string
          squad_player_id?: string
        }
        Relationships: []
      }
      game_shares: {
        Row: {
          changed: number
          event_id: string
          id: number
          shared_at: string
        }
        Insert: {
          changed: number
          event_id: string
          id?: never
          shared_at?: string
        }
        Update: {
          changed?: number
          event_id?: string
          id?: never
          shared_at?: string
        }
        Relationships: []
      }
      matches: {
        Row: {
          age_group: string
          assists: number
          body_condition: string | null
          card_received: string | null
          competition: string
          computed_rating: number | null
          created_at: string | null
          goals: number
          id: string
          logged_by: string | null
          logged_by_role: string | null
          match_date: string | null
          minutes_played: number | null
          opponent: string | null
          opponent_score: number
          position: string
          self_rating: string | null
          session_id: string | null
          team_score: number
          user_id: string
          venue: string
        }
        Insert: {
          age_group: string
          assists?: number
          body_condition?: string | null
          card_received?: string | null
          competition: string
          computed_rating?: number | null
          created_at?: string | null
          goals?: number
          id?: string
          logged_by?: string | null
          logged_by_role?: string | null
          match_date?: string | null
          minutes_played?: number | null
          opponent?: string | null
          opponent_score?: number
          position: string
          self_rating?: string | null
          session_id?: string | null
          team_score?: number
          user_id: string
          venue: string
        }
        Update: {
          age_group?: string
          assists?: number
          body_condition?: string | null
          card_received?: string | null
          competition?: string
          computed_rating?: number | null
          created_at?: string | null
          goals?: number
          id?: string
          logged_by?: string | null
          logged_by_role?: string | null
          match_date?: string | null
          minutes_played?: number | null
          opponent?: string | null
          opponent_score?: number
          position?: string
          self_rating?: string | null
          session_id?: string | null
          team_score?: number
          user_id?: string
          venue?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "coach_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_requests: {
        Row: {
          coach_user_id: string
          created_at: string | null
          id: string
          reason: string | null
          squad_player_id: string
          status: string
        }
        Insert: {
          coach_user_id: string
          created_at?: string | null
          id?: string
          reason?: string | null
          squad_player_id: string
          status?: string
        }
        Update: {
          coach_user_id?: string
          created_at?: string | null
          id?: string
          reason?: string | null
          squad_player_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_requests_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_invites: {
        Row: {
          created_at: string | null
          id: string
          invite_token: string
          parent_email: string
          player_user_id: string
          status: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          invite_token?: string
          parent_email: string
          player_user_id: string
          status?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          invite_token?: string
          parent_email?: string
          player_user_id?: string
          status?: string
        }
        Relationships: []
      }
      player_details: {
        Row: {
          age_group: string | null
          created_at: string | null
          current_club: string | null
          date_of_birth: string | null
          id: string
          position: string | null
          shirt_number: number | null
          user_id: string
        }
        Insert: {
          age_group?: string | null
          created_at?: string | null
          current_club?: string | null
          date_of_birth?: string | null
          id?: string
          position?: string | null
          shirt_number?: number | null
          user_id: string
        }
        Update: {
          age_group?: string | null
          created_at?: string | null
          current_club?: string | null
          date_of_birth?: string | null
          id?: string
          position?: string | null
          shirt_number?: number | null
          user_id?: string
        }
        Relationships: []
      }
      player_objectives: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          retired_at: string | null
          season_objective_id: string | null
          shared_at: string | null
          slot: number
          source: string
          squad_player_id: string
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          retired_at?: string | null
          season_objective_id?: string | null
          shared_at?: string | null
          slot: number
          source: string
          squad_player_id: string
          status?: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          retired_at?: string | null
          season_objective_id?: string | null
          shared_at?: string | null
          slot?: number
          source?: string
          squad_player_id?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_objectives_season_objective_id_fkey"
            columns: ["season_objective_id"]
            isOneToOne: false
            referencedRelation: "season_objectives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_objectives_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_watches: {
        Row: {
          since: string
          squad_player_id: string
          started_by: string | null
        }
        Insert: {
          since?: string
          squad_player_id: string
          started_by?: string | null
        }
        Update: {
          since?: string
          squad_player_id?: string
          started_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_watches_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: true
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_parent_links: {
        Row: {
          created_at: string | null
          id: string
          parent_user_id: string
          player_user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          parent_user_id: string
          player_user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          parent_user_id?: string
          player_user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          full_name: string
          id: string
          invite_code: string | null
          language: string | null
          nationality: string | null
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          full_name: string
          id?: string
          invite_code?: string | null
          language?: string | null
          nationality?: string | null
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string
          id?: string
          invite_code?: string | null
          language?: string | null
          nationality?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: []
      }
      recognition_awards: {
        Row: {
          award_type: string
          awarded_for: string | null
          coach_name_snapshot: string | null
          coach_user_id: string
          created_at: string | null
          id: string
          note: string | null
          organization_id: string | null
          squad_player_id: string
        }
        Insert: {
          award_type: string
          awarded_for?: string | null
          coach_name_snapshot?: string | null
          coach_user_id: string
          created_at?: string | null
          id?: string
          note?: string | null
          organization_id?: string | null
          squad_player_id: string
        }
        Update: {
          award_type?: string
          awarded_for?: string | null
          coach_name_snapshot?: string | null
          coach_user_id?: string
          created_at?: string | null
          id?: string
          note?: string | null
          organization_id?: string | null
          squad_player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recognition_awards_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      report_for_family: {
        Row: {
          evaluation_id: string
          note: string
          report: Json
          sent_at: string
          squad_player_id: string
        }
        Insert: {
          evaluation_id: string
          note?: string
          report: Json
          sent_at?: string
          squad_player_id: string
        }
        Update: {
          evaluation_id?: string
          note?: string
          report?: Json
          sent_at?: string
          squad_player_id?: string
        }
        Relationships: []
      }
      report_for_player: {
        Row: {
          evaluation_id: string
          note: string
          report: Json
          sent_at: string
          squad_player_id: string
        }
        Insert: {
          evaluation_id: string
          note?: string
          report: Json
          sent_at?: string
          squad_player_id: string
        }
        Update: {
          evaluation_id?: string
          note?: string
          report?: Json
          sent_at?: string
          squad_player_id?: string
        }
        Relationships: []
      }
      season_evaluations: {
        Row: {
          closed_at: string | null
          due_on: string
          id: string
          plan_id: string
          published_at: string
          published_by: string | null
        }
        Insert: {
          closed_at?: string | null
          due_on: string
          id?: string
          plan_id: string
          published_at?: string
          published_by?: string | null
        }
        Update: {
          closed_at?: string | null
          due_on?: string
          id?: string
          plan_id?: string
          published_at?: string
          published_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "season_evaluations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "season_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      season_objectives: {
        Row: {
          created_at: string
          id: string
          looks_like: string
          phase: string | null
          place: number
          plan_id: string
          retired_at: string | null
          shared_looks_like: string | null
          shared_title: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          looks_like?: string
          phase?: string | null
          place: number
          plan_id: string
          retired_at?: string | null
          shared_looks_like?: string | null
          shared_title?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          looks_like?: string
          phase?: string | null
          place?: number
          plan_id?: string
          retired_at?: string | null
          shared_looks_like?: string | null
          shared_title?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_objectives_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "season_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      season_plan_player_shares: {
        Row: {
          changed_at: string
          squad_player_id: string
        }
        Insert: {
          changed_at: string
          squad_player_id: string
        }
        Update: {
          changed_at?: string
          squad_player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_plan_player_shares_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: true
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      season_plan_seen: {
        Row: {
          seen_at: string
          squad_player_id: string
          viewer_user_id: string
        }
        Insert: {
          seen_at?: string
          squad_player_id: string
          viewer_user_id: string
        }
        Update: {
          seen_at?: string
          squad_player_id?: string
          viewer_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_plan_seen_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      season_plans: {
        Row: {
          coach_user_id: string
          created_at: string
          ends_on: string | null
          eval_day: number
          eval_every: string
          id: string
          last_shared_at: string | null
          positions_known: string | null
          shared_at: string | null
          shared_ends_on: string | null
          shared_eval_day: number | null
          shared_eval_every: string | null
          shared_starts_on: string | null
          squad: string
          starts_on: string | null
          unshared_parts: string[]
          unshared_players: string[]
          updated_at: string
          watch_rule: string
        }
        Insert: {
          coach_user_id?: string
          created_at?: string
          ends_on?: string | null
          eval_day?: number
          eval_every?: string
          id?: string
          last_shared_at?: string | null
          positions_known?: string | null
          shared_at?: string | null
          shared_ends_on?: string | null
          shared_eval_day?: number | null
          shared_eval_every?: string | null
          shared_starts_on?: string | null
          squad: string
          starts_on?: string | null
          unshared_parts?: string[]
          unshared_players?: string[]
          updated_at?: string
          watch_rule?: string
        }
        Update: {
          coach_user_id?: string
          created_at?: string
          ends_on?: string | null
          eval_day?: number
          eval_every?: string
          id?: string
          last_shared_at?: string | null
          positions_known?: string | null
          shared_at?: string | null
          shared_ends_on?: string | null
          shared_eval_day?: number | null
          shared_eval_every?: string | null
          shared_starts_on?: string | null
          squad?: string
          starts_on?: string | null
          unshared_parts?: string[]
          unshared_players?: string[]
          updated_at?: string
          watch_rule?: string
        }
        Relationships: []
      }
      session_attendance: {
        Row: {
          created_at: string | null
          id: string
          minutes_played: number | null
          session_id: string
          squad_player_id: string
          status: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          minutes_played?: number | null
          session_id: string
          squad_player_id: string
          status?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          minutes_played?: number | null
          session_id?: string
          squad_player_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_attendance_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "coach_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attendance_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      squad_player_also_plays: {
        Row: {
          added_at: string
          added_by: string | null
          position: string
          squad_player_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          position: string
          squad_player_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          position?: string
          squad_player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "squad_player_also_plays_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      squad_player_roles: {
        Row: {
          added_at: string
          added_by: string | null
          role: string
          squad_player_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          role: string
          squad_player_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          role?: string
          squad_player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "squad_player_roles_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      squad_players: {
        Row: {
          age: number | null
          age_group: string | null
          coach_user_id: string
          created_at: string | null
          id: string
          linked_player_id: string | null
          player_name: string
          position: string | null
          shirt_number: number | null
          status: string
        }
        Insert: {
          age?: number | null
          age_group?: string | null
          coach_user_id: string
          created_at?: string | null
          id?: string
          linked_player_id?: string | null
          player_name: string
          position?: string | null
          shirt_number?: number | null
          status?: string
        }
        Update: {
          age?: number | null
          age_group?: string | null
          coach_user_id?: string
          created_at?: string | null
          id?: string
          linked_player_id?: string | null
          player_name?: string
          position?: string | null
          shirt_number?: number | null
          status?: string
        }
        Relationships: []
      }
      squad_player_profiles: {
        Row: {
          face_hair_colour: number | null
          face_hair_style: number | null
          nationality: string | null
          preferred_foot: string | null
          squad_player_id: string
          traits: string[]
          updated_at: string
        }
        Insert: {
          face_hair_colour?: number | null
          face_hair_style?: number | null
          nationality?: string | null
          preferred_foot?: string | null
          squad_player_id: string
          traits?: string[]
          updated_at?: string
        }
        Update: {
          face_hair_colour?: number | null
          face_hair_style?: number | null
          nationality?: string | null
          preferred_foot?: string | null
          squad_player_id?: string
          traits?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "squad_player_profiles_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: true
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      squad_position_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_position: string | null
          id: string
          squad_player_id: string
          to_position: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_position?: string | null
          id?: string
          squad_player_id: string
          to_position: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_position?: string | null
          id?: string
          squad_player_id?: string
          to_position?: string
        }
        Relationships: [
          {
            foreignKeyName: "squad_position_history_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
      task_responses: {
        Row: {
          responded_at: string
          responder_user_id: string
          source_version: number
          squad_player_id: string
          task_id: string
        }
        Insert: {
          responded_at?: string
          responder_user_id: string
          source_version: number
          squad_player_id: string
          task_id: string
        }
        Update: {
          responded_at?: string
          responder_user_id?: string
          source_version?: number
          squad_player_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_responses_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_responses_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "trak_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      training_notes: {
        Row: {
          again: string | null
          coach_user_id: string
          created_at: string
          event_id: string
          note: string
          updated_at: string
        }
        Insert: {
          again?: string | null
          coach_user_id?: string
          created_at?: string
          event_id: string
          note?: string
          updated_at?: string
        }
        Update: {
          again?: string | null
          coach_user_id?: string
          created_at?: string
          event_id?: string
          note?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_notes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "coach_calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
      training_plan_drafts: {
        Row: {
          body: Json
          coach_user_id: string
          created_at: string
          event_id: string
          step: number
          updated_at: string
        }
        Insert: {
          body: Json
          coach_user_id?: string
          created_at?: string
          event_id: string
          step?: number
          updated_at?: string
        }
        Update: {
          body?: Json
          coach_user_id?: string
          created_at?: string
          event_id?: string
          step?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_plan_drafts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "coach_calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
      training_plan_practices: {
        Row: {
          group_size: number | null
          part: string
          part_type: string | null
          players_kind: string | null
          trak_drill: string | null
          trak_level: number | null
          area: string
          conditions: string
          direction: string
          drill_id: string | null
          event_id: string
          how: string
          library_session: string | null
          minutes: number
          name: string
          numbers: string
          position: number
          source: string
          targets: string
          tell: string
        }
        Insert: {
          group_size?: number | null
          part?: string
          part_type?: string | null
          players_kind?: string | null
          trak_drill?: string | null
          trak_level?: number | null
          area?: string
          conditions?: string
          direction?: string
          drill_id?: string | null
          event_id: string
          how?: string
          library_session?: string | null
          minutes: number
          name: string
          numbers?: string
          position: number
          source?: string
          targets?: string
          tell?: string
        }
        Update: {
          group_size?: number | null
          part?: string
          part_type?: string | null
          players_kind?: string | null
          trak_drill?: string | null
          trak_level?: number | null
          area?: string
          conditions?: string
          direction?: string
          drill_id?: string | null
          event_id?: string
          how?: string
          library_session?: string | null
          minutes?: number
          name?: string
          numbers?: string
          position?: number
          source?: string
          targets?: string
          tell?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_plan_practices_drill_id_fkey"
            columns: ["drill_id"]
            isOneToOne: false
            referencedRelation: "coach_drills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_plan_practices_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "training_plans"
            referencedColumns: ["event_id"]
          },
        ]
      }
      training_plans: {
        Row: {
          note: string
          coach_user_id: string
          created_at: string
          event_id: string
          updated_at: string
        }
        Insert: {
          note?: string
          coach_user_id?: string
          created_at?: string
          event_id: string
          updated_at?: string
        }
        Update: {
          note?: string
          coach_user_id?: string
          created_at?: string
          event_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_plans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "coach_calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
      trak_tasks: {
        Row: {
          answer_kind: string
          audience: string
          coach_user_id: string
          created_at: string
          due_at: string | null
          id: string
          organization_id: string
          source_id: string | null
          source_type: string
          source_version: number
          squad: string
          squad_player_id: string | null
          status: string
          title: string
        }
        Insert: {
          answer_kind: string
          audience?: string
          coach_user_id: string
          created_at?: string
          due_at?: string | null
          id?: string
          organization_id: string
          source_id?: string | null
          source_type: string
          source_version?: number
          squad: string
          squad_player_id?: string | null
          status?: string
          title: string
        }
        Update: {
          answer_kind?: string
          audience?: string
          coach_user_id?: string
          created_at?: string
          due_at?: string | null
          id?: string
          organization_id?: string
          source_id?: string | null
          source_type?: string
          source_version?: number
          squad?: string
          squad_player_id?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "trak_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trak_tasks_squad_player_id_fkey"
            columns: ["squad_player_id"]
            isOneToOne: false
            referencedRelation: "squad_players"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      child_events: {
        Args: { p_child: string }
        Returns: {
          id: string
          event_type: string
          title: string
          event_date: string | null
          start_time: string | null
          starts_at: string
          meet_time: string | null
          venue: string | null
          kit: string | null
          kit_snapshot: Json | null
          opponent: string | null
          home_away: string | null
          status: string
          cancel_reason: string | null
          sequence: number
          updated_at: string
          family_note: string | null
        }[]
      }
      child_training_attendance: {
        Args: { p_child: string }
        Returns: { attended: number; total: number }[]
      }
      coach_match_score_clash: {
        Args: {
          p_assists?: number
          p_goals?: number
          p_match_date: string
          p_opponent: string
          p_team_score: number
          p_opponent_score: number
        }
        Returns: {
          saved_assists: number
          saved_goals: number
          team_score: number
          opponent_score: number
        }[]
      }
      coach_player_birth_dates: {
        Args: { p_squad?: string }
        Returns: {
          squad_player_id: string
          date_of_birth: string
        }[]
      }
      coach_player_report: {
        Args: { p_squad_player_id: string; p_report_day: string; p_last_report_day?: string }
        Returns: Json
      }
      create_parent_invite: {
        Args: { p_email: string }
        Returns: {
          id: string
          invite_token: string
          parent_email: string
          status: string
        }[]
      }
      create_my_calendar_link: { Args: never; Returns: string }
      delete_my_account: { Args: never; Returns: undefined }
      give_my_consent: {
        Args: { p_notice_version: string; p_consent_text: string }
        Returns: undefined
      }
      my_calendar_link: {
        Args: never
        Returns: { created_at: string; last_fetched_at: string | null }[]
      }
      revoke_my_calendar_link: { Args: never; Returns: boolean }
      feature_on: { Args: { p_feature: string }; Returns: boolean }
      family_academy: {
        Args: { p_child: string }
        Returns: { logo_url: string | null; name: string }[]
      }
      family_feature_on: { Args: { p_feature: string }; Returns: boolean }
      game_plan_changes: {
        Args: { p_event_ids: string[] }
        Returns: { event_id: string; squad_player_id: string }[]
      }
      share_game_plan: {
        Args: { p_event_id: string; p_talked?: boolean }
        Returns: number
      }
      schedule_game_plan: {
        Args: { p_at?: string; p_event_id: string; p_talked?: boolean }
        Returns: number
      }
      publish_game_evaluation: {
        Args: { p_event_id: string; p_competition?: string | null; p_home_away?: string | null }
        Returns: Json
      }
      save_game_evaluation: {
        Args: {
          p_event_id: string
          p_our_score: number
          p_their_score: number
          p_goals: Json
          p_how_they_scored: string
          p_plan_worked: (string | null)[]
          p_players: Json
        }
        Returns: string
      }
      get_children_awaiting_consent: {
        Args: never
        Returns: {
          player_user_id: string
          full_name: string
          age_years: number
        }[]
      }
      get_coach_id_by_invite_code: { Args: { p_code: string }; Returns: string }
      get_parent_invite_by_token: {
        Args: { p_token: string }
        Returns: {
          created_at: string
          id: string
          invite_token: string
          parent_email: string
          player_user_id: string
          status: string
        }[]
      }
      get_parent_pending_invites_for_current_user: {
        Args: never
        Returns: {
          created_at: string
          id: string
          parent_email: string
          player_user_id: string
          status: string
        }[]
      }
      get_player_invites_for_current_user: {
        Args: never
        Returns: {
          created_at: string
          id: string
          invite_token: string
          parent_email: string
          player_user_id: string
          status: string
        }[]
      }
      get_profile_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      is_club_admin: { Args: never; Returns: boolean }
      report_cant_make_it: {
        Args: { p_event_id: string; p_child: string; p_reason?: string | null }
        Returns: undefined
      }
      undo_cant_make_it: {
        Args: { p_event_id: string; p_child: string }
        Returns: undefined
      }
      confirm_event_attendance: {
        Args: { p_event_id: string; p_squad_player_id: string }
        Returns: undefined
      }
      unconfirm_event_attendance: {
        Args: { p_event_id: string; p_squad_player_id: string }
        Returns: undefined
      }
      coach_squad_season: {
        Args: { p_from: string; p_to: string; p_squad?: string | null }
        Returns: {
          match_date: string
          opponent: string | null
          session_id: string | null
          team_score: number
          opponent_score: number
          squad_player_id: string
          minutes_played: number | null
          goals: number
          assists: number
        }[]
      }
      record_parental_consent: {
        Args: {
          p_player_user_id: string
          p_relationship: string
          p_purposes: Json
          p_notice_version: string
          p_consent_text: string
        }
        Returns: string
      }
      remove_coach_from_org: { Args: { p_coach_user_id: string }; Returns: undefined }
      link_parent_to_players_by_email: {
        Args: { p_email: string }
        Returns: number
      }
      log_match_for_player: {
        Args: {
          p_age_group: string
          p_assists: number
          p_body_condition: string
          p_card_received: string
          p_competition: string
          p_computed_rating: number
          p_goals: number
          p_match_date?: string
          p_minutes_played: number | null
          p_opponent: string
          p_opponent_score: number
          p_position: string
          p_self_rating: string
          p_session_id?: string
          p_team_score: number
          p_user_id: string
          p_venue: string
        }
        Returns: undefined
      }
      save_player_objectives: {
        Args: { p_objectives: Json; p_squad_player_id: string }
        Returns: undefined
      }
      save_player_position_and_roles: {
        Args: {
          p_also_plays: string[]
          p_position: string
          p_roles: string[]
          p_squad_player_id: string
        }
        Returns: undefined
      }
      delete_formation: { Args: { p_id: string }; Returns: undefined }
      load_default_formation: { Args: { p_event_id: string }; Returns: Json }
      set_default_formation: { Args: { p_default: boolean; p_id: string }; Returns: undefined }
      use_formation_for_matches: { Args: { p_event_ids: string[]; p_formation_id: string }; Returns: Json }
      undo_formation_copy: { Args: { p_event_ids: string[]; p_formation_id: string }; Returns: Json }
      save_formation: {
        Args: {
          p_format: number
          p_id: string | null
          p_name: string
          p_shape: string
          p_squad: string
          p_starters: Json
        }
        Returns: string
      }
      start_formations: {
        Args: { p_formations: Json; p_squad: string }
        Returns: boolean
      }
      save_training_plan: {
        Args: { p_event_id: string; p_practices: Json; p_note?: string }
        Returns: undefined
      }
      set_player_position: {
        Args: { p_squad_player_id: string; p_position: string }
        Returns: string
      }
      share_season_plan: {
        Args: { p_plan_id: string; p_talked?: boolean }
        Returns: string
      }
      publish_evaluation: {
        Args: { p_due_on: string; p_plan_id: string; p_players: Json }
        Returns: Json
      }
      publish_evaluation_with_objectives: {
        Args: { p_close?: boolean; p_due_on: string; p_objectives: Json; p_plan_id: string; p_players: Json }
        Returns: Json
      }
      resolve_stuck_objective: {
        Args: { p_choice: string; p_player_objective_id: string; p_title?: string }
        Returns: undefined
      }
      stuck_player_objectives: {
        Args: never
        Returns: { player_objective_id: string; squad_player_id: string }[]
      }
      evaluation_progress: {
        Args: { p_assessments: string[]; p_child?: string }
        Returns: { assessment_id: string; due_on: string; objectives: Json }[]
      }
      season_plan_for_player: {
        Args: { p_child?: string }
        Returns: {
          also_plays: string[]
          coach_name: string
          ends_on: string | null
          eval_day: number | null
          eval_every: string | null
          is_new: boolean
          last_evaluation_on: string | null
          objectives: Json
          position: string | null
          roles: string[]
          season_objectives: Json
          shared_at: string | null
          squad: string
          squad_player_id: string
          starts_on: string | null
          time_zone: string
        }[]
      }
      mark_season_plan_seen: { Args: { p_child?: string }; Returns: undefined }
      my_tasks: {
        Args: { p_child?: string }
        Returns: {
          answer_kind: string
          answered: boolean
          due_at: string | null
          outdated: boolean
          source_id: string | null
          source_type: string
          task_id: string
          time_zone: string
          title: string
        }[]
      }
      my_training_plans: {
        Args: never
        Returns: {
          area: string
          conditions: string
          direction: string
          event_date: string
          event_id: string
          how: string
          minutes: number
          name: string
          numbers: string
          part: string
          position: number
          session_id: string | null
          targets: string
          trak_drill: string | null
          trak_level: number | null
        }[]
      }
      respond_to_task: {
        Args: { p_child?: string; p_task_id: string }
        Returns: undefined
      }
      undo_task_response: {
        Args: { p_child?: string; p_task_id: string }
        Returns: undefined
      }
      create_task: {
        Args: {
          p_answer_kind: string
          p_due_on: string
          p_squad: string
          p_squad_player_id: string | null
          p_title: string
        }
        Returns: string
      }
      post_announcement: {
        Args: { p_body: string; p_got_it_by?: string; p_link?: string; p_squad: string }
        Returns: string
      }
      withdraw_announcement: { Args: { p_id: string }; Returns: undefined }
      coach_announcements: {
        Args: never
        Returns: {
          body: string
          got_it_by: string | null
          id: string
          link: string | null
          published_at: string
          squad: string
          withdrawn_at: string | null
        }[]
      }
      my_announcements: {
        Args: { p_child?: string }
        Returns: {
          body: string
          id: string
          link: string | null
          published_at: string
          time_zone: string
        }[]
      }
      watch_players:{ Args: { p_squad_player_ids: string[] }; Returns: number }
      take_event_register: {
        Args: { p_event_id: string; p_present: string[] }
        Returns: string
      }
      withdraw_my_consent: {
        Args: never
        Returns: undefined
      }
    }
    Enums: {
      user_role: "player" | "coach" | "parent" | "club"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      user_role: ["player", "coach", "parent", "club"],
    },
  },
} as const
