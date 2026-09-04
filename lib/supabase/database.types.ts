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
      audit_log: {
        Row: {
          action: string
          actor: string | null
          changed_data: Json | null
          created_at: string
          id: string
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          actor?: string | null
          changed_data?: Json | null
          created_at?: string
          id?: string
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          actor?: string | null
          changed_data?: Json | null
          created_at?: string
          id?: string
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      suspicious_activity_flags: {
        Row: {
          created_at: string
          customer_id: string | null
          id: string
          loan_id: string | null
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["suspicious_flag_status"]
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          loan_id?: string | null
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["suspicious_flag_status"]
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          loan_id?: string | null
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["suspicious_flag_status"]
        }
        Relationships: []
      }
      reminder_log: {
        Row: {
          created_by: string | null
          id: string
          loan_id: string
          sent_at: string
        }
        Insert: {
          created_by?: string | null
          id?: string
          loan_id: string
          sent_at?: string
        }
        Update: {
          created_by?: string | null
          id?: string
          loan_id?: string
          sent_at?: string
        }
        Relationships: []
      }
      inventory_status_history: {
        Row: {
          changed_at: string
          id: string
          inventory_item_id: string
          new_status: Database["public"]["Enums"]["inventory_status"]
          old_status: Database["public"]["Enums"]["inventory_status"] | null
        }
        Insert: {
          changed_at?: string
          id?: string
          inventory_item_id: string
          new_status: Database["public"]["Enums"]["inventory_status"]
          old_status?: Database["public"]["Enums"]["inventory_status"] | null
        }
        Update: {
          changed_at?: string
          id?: string
          inventory_item_id?: string
          new_status?: Database["public"]["Enums"]["inventory_status"]
          old_status?: Database["public"]["Enums"]["inventory_status"] | null
        }
        Relationships: []
      }
      physical_inventory_audits: {
        Row: {
          created_at: string
          discrepancy_count: number
          id: string
          notes: string | null
          performed_by: string | null
        }
        Insert: {
          created_at?: string
          discrepancy_count?: number
          id?: string
          notes?: string | null
          performed_by?: string | null
        }
        Update: {
          created_at?: string
          discrepancy_count?: number
          id?: string
          notes?: string | null
          performed_by?: string | null
        }
        Relationships: []
      }
      physical_inventory_audit_items: {
        Row: {
          audit_id: string
          expected_status: Database["public"]["Enums"]["inventory_status"]
          found: boolean
          id: string
          inventory_item_id: string
          notes: string | null
        }
        Insert: {
          audit_id: string
          expected_status: Database["public"]["Enums"]["inventory_status"]
          found: boolean
          id?: string
          inventory_item_id: string
          notes?: string | null
        }
        Update: {
          audit_id?: string
          expected_status?: Database["public"]["Enums"]["inventory_status"]
          found?: boolean
          id?: string
          inventory_item_id?: string
          notes?: string | null
        }
        Relationships: []
      }
      auction_batches: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
        }
        Relationships: []
      }
      auction_batch_items: {
        Row: {
          batch_id: string
          id: string
          inventory_item_id: string
        }
        Insert: {
          batch_id: string
          id?: string
          inventory_item_id: string
        }
        Update: {
          batch_id?: string
          id?: string
          inventory_item_id?: string
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          appraisal_item_id: string
          created_at: string
          id: string
          status: Database["public"]["Enums"]["inventory_status"]
          updated_at: string
          vault_location: string
        }
        Insert: {
          appraisal_item_id: string
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["inventory_status"]
          updated_at?: string
          vault_location: string
        }
        Update: {
          appraisal_item_id?: string
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["inventory_status"]
          updated_at?: string
          vault_location?: string
        }
        Relationships: []
      }
      cash_flow_entries: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string | null
          direction: Database["public"]["Enums"]["cash_flow_direction"]
          entry_type: Database["public"]["Enums"]["cash_flow_type"]
          id: string
          related_loan_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          direction: Database["public"]["Enums"]["cash_flow_direction"]
          entry_type: Database["public"]["Enums"]["cash_flow_type"]
          id?: string
          related_loan_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          direction?: Database["public"]["Enums"]["cash_flow_direction"]
          entry_type?: Database["public"]["Enums"]["cash_flow_type"]
          id?: string
          related_loan_id?: string | null
        }
        Relationships: []
      }
      loans: {
        Row: {
          appraisal_item_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          extension_count: number
          grace_period_days: number
          id: string
          interest_rate_percent: number
          inventory_item_id: string | null
          loan_date: string
          lost_ticket_used: boolean
          maturity_date: string
          principal_amount: number
          principal_balance: number
          status: Database["public"]["Enums"]["loan_status"]
          ticket_number: string
          updated_at: string
        }
        Insert: {
          appraisal_item_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          extension_count?: number
          grace_period_days: number
          id?: string
          interest_rate_percent: number
          inventory_item_id?: string | null
          loan_date?: string
          lost_ticket_used?: boolean
          maturity_date: string
          principal_amount: number
          principal_balance: number
          status?: Database["public"]["Enums"]["loan_status"]
          ticket_number: string
          updated_at?: string
        }
        Update: {
          appraisal_item_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          extension_count?: number
          grace_period_days?: number
          id?: string
          interest_rate_percent?: number
          inventory_item_id?: string | null
          loan_date?: string
          lost_ticket_used?: boolean
          maturity_date?: string
          principal_amount?: number
          principal_balance?: number
          status?: Database["public"]["Enums"]["loan_status"]
          ticket_number?: string
          updated_at?: string
        }
        Relationships: []
      }
      loan_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          interest_portion: number
          loan_id: string
          principal_portion: number
          receipt_number: string
          verified_via_lost_ticket: boolean
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          interest_portion?: number
          loan_id: string
          principal_portion?: number
          receipt_number: string
          verified_via_lost_ticket?: boolean
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          interest_portion?: number
          loan_id?: string
          principal_portion?: number
          receipt_number?: string
          verified_via_lost_ticket?: boolean
        }
        Relationships: []
      }
      loan_extensions: {
        Row: {
          additional_interest_amount: number
          created_at: string
          created_by: string | null
          id: string
          loan_id: string
          new_maturity_date: string
          previous_maturity_date: string
        }
        Insert: {
          additional_interest_amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          loan_id: string
          new_maturity_date: string
          previous_maturity_date: string
        }
        Update: {
          additional_interest_amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          loan_id?: string
          new_maturity_date?: string
          previous_maturity_date?: string
        }
        Relationships: []
      }
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
      loan_status: "active" | "extended" | "redeemed" | "defaulted" | "forfeited"
      cash_flow_type: "loan_disbursement" | "payment_received" | "expense" | "revenue" | "forfeiture"
      cash_flow_direction: "in" | "out"
      inventory_status: "pawned" | "extended" | "redeemed" | "forfeited" | "queued_for_auction"
      suspicious_flag_status: "open" | "dismissed" | "investigating" | "blacklisted"
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
