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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      appraisal_items: {
        Row: {
          appraised_by: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          category: Database["public"]["Enums"]["item_category"]
          category_other: string | null
          computed_value: number
          condition_notes: string | null
          counterfeit_resolution:
            | Database["public"]["Enums"]["counterfeit_resolution"]
            | null
          counterfeit_resolved_at: string | null
          counterfeit_resolved_by: string | null
          created_at: string
          customer_id: string | null
          gold_price_used: number
          id: string
          is_counterfeit_risk: boolean
          karat: number
          ltv_percent_used: number
          photo_paths: string[]
          purity_percent: number | null
          status: Database["public"]["Enums"]["appraisal_status"]
          suggested_loan_max: number
          suggested_loan_min: number
          updated_at: string
          weight_grams: number
        }
        Insert: {
          appraised_by?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          category?: Database["public"]["Enums"]["item_category"]
          category_other?: string | null
          computed_value: number
          condition_notes?: string | null
          counterfeit_resolution?:
            | Database["public"]["Enums"]["counterfeit_resolution"]
            | null
          counterfeit_resolved_at?: string | null
          counterfeit_resolved_by?: string | null
          created_at?: string
          customer_id?: string | null
          gold_price_used: number
          id?: string
          is_counterfeit_risk?: boolean
          karat: number
          ltv_percent_used: number
          photo_paths?: string[]
          purity_percent?: number | null
          status?: Database["public"]["Enums"]["appraisal_status"]
          suggested_loan_max: number
          suggested_loan_min: number
          updated_at?: string
          weight_grams: number
        }
        Update: {
          appraised_by?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          category?: Database["public"]["Enums"]["item_category"]
          category_other?: string | null
          computed_value?: number
          condition_notes?: string | null
          counterfeit_resolution?:
            | Database["public"]["Enums"]["counterfeit_resolution"]
            | null
          counterfeit_resolved_at?: string | null
          counterfeit_resolved_by?: string | null
          created_at?: string
          customer_id?: string | null
          gold_price_used?: number
          id?: string
          is_counterfeit_risk?: boolean
          karat?: number
          ltv_percent_used?: number
          photo_paths?: string[]
          purity_percent?: number | null
          status?: Database["public"]["Enums"]["appraisal_status"]
          suggested_loan_max?: number
          suggested_loan_min?: number
          updated_at?: string
          weight_grams?: number
        }
        Relationships: [
          {
            foreignKeyName: "appraisal_items_appraised_by_fkey"
            columns: ["appraised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appraisal_items_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appraisal_items_counterfeit_resolved_by_fkey"
            columns: ["counterfeit_resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appraisal_items_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_history_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "appraisal_items_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "auction_batch_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "auction_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_batch_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_batches: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auction_batches_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
      cash_flow_entries: {
        Row: {
          amount: number
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          direction: Database["public"]["Enums"]["cash_flow_direction"]
          entry_type: Database["public"]["Enums"]["cash_flow_type"]
          id: string
          is_memo: boolean
          related_loan_id: string | null
        }
        Insert: {
          amount: number
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          direction: Database["public"]["Enums"]["cash_flow_direction"]
          entry_type: Database["public"]["Enums"]["cash_flow_type"]
          id?: string
          is_memo?: boolean
          related_loan_id?: string | null
        }
        Update: {
          amount?: number
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          direction?: Database["public"]["Enums"]["cash_flow_direction"]
          entry_type?: Database["public"]["Enums"]["cash_flow_type"]
          id?: string
          is_memo?: boolean
          related_loan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_flow_entries_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_flow_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_flow_entries_loan_fkey"
            columns: ["related_loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
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
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
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
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
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
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
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
        Relationships: [
          {
            foreignKeyName: "customers_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          appraisal_item_id: string
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          created_at: string
          id: string
          status: Database["public"]["Enums"]["inventory_status"]
          updated_at: string
          vault_location: string
        }
        Insert: {
          appraisal_item_id: string
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["inventory_status"]
          updated_at?: string
          vault_location: string
        }
        Update: {
          appraisal_item_id?: string
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["inventory_status"]
          updated_at?: string
          vault_location?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_appraisal_item_id_fkey"
            columns: ["appraisal_item_id"]
            isOneToOne: false
            referencedRelation: "appraisal_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "inventory_status_history_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_extensions: {
        Row: {
          additional_interest_amount: number
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          capitalized_amount: number
          created_at: string
          created_by: string | null
          extension_type: Database["public"]["Enums"]["extension_type"]
          id: string
          loan_id: string
          new_maturity_date: string
          previous_maturity_date: string
        }
        Insert: {
          additional_interest_amount: number
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          capitalized_amount?: number
          created_at?: string
          created_by?: string | null
          extension_type?: Database["public"]["Enums"]["extension_type"]
          id?: string
          loan_id: string
          new_maturity_date: string
          previous_maturity_date: string
        }
        Update: {
          additional_interest_amount?: number
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          capitalized_amount?: number
          created_at?: string
          created_by?: string | null
          extension_type?: Database["public"]["Enums"]["extension_type"]
          id?: string
          loan_id?: string
          new_maturity_date?: string
          previous_maturity_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_extensions_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_extensions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_extensions_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_payments: {
        Row: {
          amount: number
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
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
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
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
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          interest_portion?: number
          loan_id?: string
          principal_portion?: number
          receipt_number?: string
          verified_via_lost_ticket?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "loan_payments_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_payments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          appraisal_item_id: string
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          defaulted_at: string | null
          extension_count: number
          forfeited_at: string | null
          grace_period_days: number
          id: string
          interest_accrued_through: string | null
          interest_owed: number
          interest_rate_percent: number
          inventory_item_id: string | null
          late_payment_count: number
          loan_date: string
          lost_ticket_used: boolean
          maturity_date: string
          principal_amount: number
          principal_balance: number
          redeemed_at: string | null
          reinstated_at: string | null
          status: Database["public"]["Enums"]["loan_status"]
          ticket_number: string
          updated_at: string
        }
        Insert: {
          appraisal_item_id: string
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          defaulted_at?: string | null
          extension_count?: number
          forfeited_at?: string | null
          grace_period_days: number
          id?: string
          interest_accrued_through?: string | null
          interest_owed?: number
          interest_rate_percent: number
          inventory_item_id?: string | null
          late_payment_count?: number
          loan_date?: string
          lost_ticket_used?: boolean
          maturity_date: string
          principal_amount: number
          principal_balance: number
          redeemed_at?: string | null
          reinstated_at?: string | null
          status?: Database["public"]["Enums"]["loan_status"]
          ticket_number: string
          updated_at?: string
        }
        Update: {
          appraisal_item_id?: string
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          defaulted_at?: string | null
          extension_count?: number
          forfeited_at?: string | null
          grace_period_days?: number
          id?: string
          interest_accrued_through?: string | null
          interest_owed?: number
          interest_rate_percent?: number
          inventory_item_id?: string | null
          late_payment_count?: number
          loan_date?: string
          lost_ticket_used?: boolean
          maturity_date?: string
          principal_amount?: number
          principal_balance?: number
          redeemed_at?: string | null
          reinstated_at?: string | null
          status?: Database["public"]["Enums"]["loan_status"]
          ticket_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loans_appraisal_item_id_fkey"
            columns: ["appraisal_item_id"]
            isOneToOne: false
            referencedRelation: "appraisal_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_history_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "loans_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "physical_inventory_audit_items_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "physical_inventory_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_inventory_audit_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      physical_inventory_audits: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          created_at: string
          discrepancy_count: number
          id: string
          notes: string | null
          performed_by: string | null
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          discrepancy_count?: number
          id?: string
          notes?: string | null
          performed_by?: string | null
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          discrepancy_count?: number
          id?: string
          notes?: string | null
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "physical_inventory_audits_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_inventory_audits_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      reminder_log: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          created_by: string | null
          id: string
          loan_id: string
          sent_at: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_by?: string | null
          id?: string
          loan_id: string
          sent_at?: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_by?: string | null
          id?: string
          loan_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_log_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_log_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_log_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      score_weights: {
        Row: {
          description: string
          key: string
          value: number
        }
        Insert: {
          description: string
          key: string
          value: number
        }
        Update: {
          description?: string
          key?: string
          value?: number
        }
        Relationships: []
      }
      suspicious_activity_flags: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
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
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
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
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          loan_id?: string | null
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["suspicious_flag_status"]
        }
        Relationships: [
          {
            foreignKeyName: "suspicious_activity_flags_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspicious_activity_flags_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_history_summary"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "suspicious_activity_flags_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspicious_activity_flags_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspicious_activity_flags_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          gold_price_per_gram: number
          grace_period_days: number
          id: number
          interest_rate_percent: number
          ltv_percent: number
          price_18k: number
          price_21k: number
          price_24k: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          gold_price_per_gram: number
          grace_period_days: number
          id?: number
          interest_rate_percent: number
          ltv_percent: number
          price_18k?: number
          price_21k?: number
          price_24k?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          gold_price_per_gram?: number
          grace_period_days?: number
          id?: number
          interest_rate_percent?: number
          ltv_percent?: number
          price_18k?: number
          price_21k?: number
          price_24k?: number
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
      customer_history_summary: {
        Row: {
          active_loans: number | null
          customer_id: string | null
          defaulted_loans: number | null
          delinquent_loans: number | null
          redeemed_loans: number | null
          reinstated_loans: number | null
          renewed_loans: number | null
          total_loans: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_edit_cash_entry: {
        Args: {
          p_amount: number
          p_description: string
          p_id: string
          p_reason: string
        }
        Returns: undefined
      }
      admin_edit_customer: {
        Args: {
          p_address: string
          p_contact_number: string
          p_full_name: string
          p_id: string
          p_id_number: string
          p_id_type: string
          p_reason: string
        }
        Returns: undefined
      }
      admin_edit_loan: {
        Args: {
          p_id: string
          p_interest_rate_percent: number
          p_maturity_date: string
          p_principal_amount: number
          p_reason: string
        }
        Returns: undefined
      }
      admin_edit_payment: {
        Args: { p_amount: number; p_id: string; p_reason: string }
        Returns: undefined
      }
      archive_record: {
        Args: { p_id: string; p_reason: string; p_table: string }
        Returns: undefined
      }
      capitalize_loan: { Args: { p_loan_id: string }; Returns: Json }
      create_pawn_loan: {
        Args: {
          p_appraisal_item_id: string
          p_customer_id: string
          p_principal_amount: number
          p_vault_location?: string
        }
        Returns: string
      }
      ctm_is_system: { Args: never; Returns: boolean }
      ctm_norm_id: { Args: { v: string }; Returns: string }
      ctm_receipt_number: { Args: never; Returns: string }
      ctm_today: { Args: never; Returns: string }
      forfeit_loan: { Args: { p_loan_id: string }; Returns: undefined }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      is_admin: { Args: never; Returns: boolean }
      record_payment: {
        Args: {
          p_amount: number
          p_id_confirm?: string
          p_loan_id: string
          p_lost_ticket?: boolean
        }
        Returns: Json
      }
      redeem_loan: {
        Args: {
          p_id_confirm?: string
          p_loan_id: string
          p_lost_ticket?: boolean
        }
        Returns: undefined
      }
      reinstate_loan: { Args: { p_loan_id: string }; Returns: undefined }
      renew_loan: { Args: { p_loan_id: string }; Returns: Json }
      restore_record: {
        Args: { p_id: string; p_table: string }
        Returns: undefined
      }
      run_default_detection: { Args: never; Returns: number }
    }
    Enums: {
      aml_status: "clear" | "flagged"
      appraisal_status: "available" | "pawned"
      cash_flow_direction: "in" | "out"
      cash_flow_type:
        | "loan_disbursement"
        | "payment_received"
        | "expense"
        | "revenue"
        | "forfeiture"
        | "adjustment"
        | "capitalization"
      counterfeit_resolution: "pending" | "cleared" | "confirmed"
      extension_type: "renewal" | "capitalized"
      inventory_status:
        | "pawned"
        | "extended"
        | "redeemed"
        | "forfeited"
        | "queued_for_auction"
      item_category:
        | "earrings"
        | "ring"
        | "pendant"
        | "chain"
        | "bracelet"
        | "pendant_with_chain"
        | "others"
      loan_status:
        | "active"
        | "extended"
        | "redeemed"
        | "defaulted"
        | "forfeited"
        | "reinstated"
      staff_role: "admin" | "operator" | "cashier" | "appraiser"
      suspicious_flag_status:
        | "open"
        | "dismissed"
        | "investigating"
        | "blacklisted"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never
