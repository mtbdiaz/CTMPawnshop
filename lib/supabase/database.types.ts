export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      appraisal_items: {
        Row: {
          appraised_by: string | null
          computed_value: number
          condition_notes: string | null
          counterfeit_resolution: Database["public"]["Enums"]["counterfeit_resolution"] | null
          counterfeit_resolved_at: string | null
          counterfeit_resolved_by: string | null
          created_at: string
          customer_id: string
          gold_price_used: number
          id: string
          is_counterfeit_risk: boolean
          karat: number
          ltv_percent_used: number
          photo_paths: string[]
          purity_percent: number
          suggested_loan_max: number
          suggested_loan_min: number
          updated_at: string
          weight_grams: number
        }
        Insert: {
          appraised_by?: string | null
          computed_value: number
          condition_notes?: string | null
          counterfeit_resolution?: Database["public"]["Enums"]["counterfeit_resolution"] | null
          counterfeit_resolved_at?: string | null
          counterfeit_resolved_by?: string | null
          created_at?: string
          customer_id: string
          gold_price_used: number
          id?: string
          is_counterfeit_risk?: boolean
          karat: number
          ltv_percent_used: number
          photo_paths?: string[]
          purity_percent: number
          suggested_loan_max: number
          suggested_loan_min: number
          updated_at?: string
          weight_grams: number
        }
        Update: {
          appraised_by?: string | null
          computed_value?: number
          condition_notes?: string | null
          counterfeit_resolution?: Database["public"]["Enums"]["counterfeit_resolution"] | null
          counterfeit_resolved_at?: string | null
          counterfeit_resolved_by?: string | null
          created_at?: string
          customer_id?: string
          gold_price_used?: number
          id?: string
          is_counterfeit_risk?: boolean
          karat?: number
          ltv_percent_used?: number
          photo_paths?: string[]
          purity_percent?: number
          suggested_loan_max?: number
          suggested_loan_min?: number
          updated_at?: string
          weight_grams?: number
        }
        Relationships: [
          {
            foreignKeyName: "appraisal_items_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string
          aml_checked_at: string | null
          aml_notes: string | null
          aml_status: Database["public"]["Enums"]["aml_status"]
          blacklist_reason: string | null
          contact_number: string
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          email: string | null
          full_name: string
          id: string
          id_number: string
          id_type: string
          is_blacklisted: boolean
          updated_at: string
        }
        Insert: {
          address: string
          aml_checked_at?: string | null
          aml_notes?: string | null
          aml_status?: Database["public"]["Enums"]["aml_status"]
          blacklist_reason?: string | null
          contact_number: string
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          email?: string | null
          full_name: string
          id?: string
          id_number: string
          id_type: string
          is_blacklisted?: boolean
          updated_at?: string
        }
        Update: {
          address?: string
          aml_checked_at?: string | null
          aml_notes?: string | null
          aml_status?: Database["public"]["Enums"]["aml_status"]
          blacklist_reason?: string | null
          contact_number?: string
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          email?: string | null
          full_name?: string
          id?: string
          id_number?: string
          id_type?: string
          is_blacklisted?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["staff_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          gold_price_per_gram: number
          grace_period_days: number
          id: number
          interest_rate_percent: number
          ltv_percent: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          gold_price_per_gram: number
          grace_period_days: number
          id?: number
          interest_rate_percent: number
          ltv_percent: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          gold_price_per_gram?: number
          grace_period_days?: number
          id?: number
          interest_rate_percent?: number
          ltv_percent?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      staff_role: "admin" | "operator" | "cashier" | "appraiser"
      aml_status: "clear" | "flagged"
      counterfeit_resolution: "pending" | "cleared" | "confirmed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database["public"]

export type Tables<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Update"]
export type Enums<T extends keyof DefaultSchema["Enums"]> =
  DefaultSchema["Enums"][T]
