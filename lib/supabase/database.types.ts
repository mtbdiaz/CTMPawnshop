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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      appraisal_items: {
        Row: {
          appraisal_no: number
          appraised_by: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          category: Database["public"]["Enums"]["item_category"]
          category_other: string | null
          computed_value: number
          condition_notes: string | null
          counterfeit_flagged_at: string | null
          counterfeit_resolution:
            | Database["public"]["Enums"]["counterfeit_resolution"]
            | null
          counterfeit_resolution_notes: string | null
          counterfeit_resolved_at: string | null
          counterfeit_resolved_by: string | null
          created_at: string
          customer_id: string | null
          gold_price_used: number
          id: string
          is_counterfeit_risk: boolean
          is_demo: boolean
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
          appraisal_no?: number
          appraised_by?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          category?: Database["public"]["Enums"]["item_category"]
          category_other?: string | null
          computed_value: number
          condition_notes?: string | null
          counterfeit_flagged_at?: string | null
          counterfeit_resolution?:
            | Database["public"]["Enums"]["counterfeit_resolution"]
            | null
          counterfeit_resolution_notes?: string | null
          counterfeit_resolved_at?: string | null
          counterfeit_resolved_by?: string | null
          created_at?: string
          customer_id?: string | null
          gold_price_used: number
          id?: string
          is_counterfeit_risk?: boolean
          is_demo?: boolean
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
          appraisal_no?: number
          appraised_by?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          category?: Database["public"]["Enums"]["item_category"]
          category_other?: string | null
          computed_value?: number
          condition_notes?: string | null
          counterfeit_flagged_at?: string | null
          counterfeit_resolution?:
            | Database["public"]["Enums"]["counterfeit_resolution"]
            | null
          counterfeit_resolution_notes?: string | null
          counterfeit_resolved_at?: string | null
          counterfeit_resolved_by?: string | null
          created_at?: string
          customer_id?: string | null
          gold_price_used?: number
          id?: string
          is_counterfeit_risk?: boolean
          is_demo?: boolean
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
          buyer_name: string | null
          id: string
          inventory_item_id: string
          is_demo: boolean
          min_price: number | null
          no_reserve: boolean
          reserve_set_at: string | null
          reserve_set_by: string | null
          sale_notes: string | null
          sale_price: number | null
          sold_at: string | null
          sold_by: string | null
          unsold_at: string | null
          unsold_by: string | null
          unsold_reason: string | null
        }
        Insert: {
          batch_id: string
          buyer_name?: string | null
          id?: string
          inventory_item_id: string
          is_demo?: boolean
          min_price?: number | null
          no_reserve?: boolean
          reserve_set_at?: string | null
          reserve_set_by?: string | null
          sale_notes?: string | null
          sale_price?: number | null
          sold_at?: string | null
          sold_by?: string | null
          unsold_at?: string | null
          unsold_by?: string | null
          unsold_reason?: string | null
        }
        Update: {
          batch_id?: string
          buyer_name?: string | null
          id?: string
          inventory_item_id?: string
          is_demo?: boolean
          min_price?: number | null
          no_reserve?: boolean
          reserve_set_at?: string | null
          reserve_set_by?: string | null
          sale_notes?: string | null
          sale_price?: number | null
          sold_at?: string | null
          sold_by?: string | null
          unsold_at?: string | null
          unsold_by?: string | null
          unsold_reason?: string | null
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
          {
            foreignKeyName: "auction_batch_items_sold_by_fkey"
            columns: ["sold_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_batches: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          auction_date: string | null
          auction_place: string | null
          batch_no: number
          created_at: string
          created_by: string | null
          id: string
          is_demo: boolean
          notes: string | null
          request_id: string | null
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          auction_date?: string | null
          auction_place?: string | null
          batch_no?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          request_id?: string | null
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          auction_date?: string | null
          auction_place?: string | null
          batch_no?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          request_id?: string | null
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
          is_demo: boolean
          old_data: Json | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          actor?: string | null
          changed_data?: Json | null
          created_at?: string
          id?: string
          is_demo?: boolean
          old_data?: Json | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          actor?: string | null
          changed_data?: Json | null
          created_at?: string
          id?: string
          is_demo?: boolean
          old_data?: Json | null
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
          is_demo: boolean
          is_memo: boolean
          related_loan_id: string | null
          request_id: string | null
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
          is_demo?: boolean
          is_memo?: boolean
          related_loan_id?: string | null
          request_id?: string | null
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
          is_demo?: boolean
          is_memo?: boolean
          related_loan_id?: string | null
          request_id?: string | null
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
      ctm_requests: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          loan_id: string
          result: Json | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id: string
          kind: string
          loan_id: string
          result?: Json | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          loan_id?: string
          result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ctm_requests_loan_id_fkey"
            columns: ["loan_id"]
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
          customer_no: number
          date_of_birth: string | null
          email: string | null
          first_name: string | null
          full_name: string
          id: string
          id_number: string
          id_type: string
          is_blacklisted: boolean
          is_demo: boolean
          last_name: string | null
          middle_name: string | null
          suffix: string | null
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
          customer_no?: number
          date_of_birth?: string | null
          email?: string | null
          first_name?: string | null
          full_name: string
          id?: string
          id_number: string
          id_type: string
          is_blacklisted?: boolean
          is_demo?: boolean
          last_name?: string | null
          middle_name?: string | null
          suffix?: string | null
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
          customer_no?: number
          date_of_birth?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string
          id?: string
          id_number?: string
          id_type?: string
          is_blacklisted?: boolean
          is_demo?: boolean
          last_name?: string | null
          middle_name?: string | null
          suffix?: string | null
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
          is_demo: boolean
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
          is_demo?: boolean
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
          is_demo?: boolean
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
          is_demo: boolean
          new_status: Database["public"]["Enums"]["inventory_status"]
          old_status: Database["public"]["Enums"]["inventory_status"] | null
        }
        Insert: {
          changed_at?: string
          id?: string
          inventory_item_id: string
          is_demo?: boolean
          new_status: Database["public"]["Enums"]["inventory_status"]
          old_status?: Database["public"]["Enums"]["inventory_status"] | null
        }
        Update: {
          changed_at?: string
          id?: string
          inventory_item_id?: string
          is_demo?: boolean
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
          is_demo: boolean
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
          is_demo?: boolean
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
          is_demo?: boolean
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
          is_demo: boolean
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
          is_demo?: boolean
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
          is_demo?: boolean
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
          is_demo: boolean
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
          is_demo?: boolean
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
          is_demo?: boolean
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
      physical_inventory_audit_followups: {
        Row: {
          created_at: string
          created_by: string | null
          found_location: string | null
          id: string
          is_demo: boolean
          line_id: string
          notes: string
          outcome: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          found_location?: string | null
          id?: string
          is_demo?: boolean
          line_id: string
          notes: string
          outcome: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          found_location?: string | null
          id?: string
          is_demo?: boolean
          line_id?: string
          notes?: string
          outcome?: string
        }
        Relationships: [
          {
            foreignKeyName: "physical_inventory_audit_followups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_inventory_audit_followups_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "physical_inventory_audit_items"
            referencedColumns: ["id"]
          },
        ]
      }
      physical_inventory_audit_items: {
        Row: {
          audit_id: string
          checked_at: string | null
          checked_by: string | null
          expected_status: Database["public"]["Enums"]["inventory_status"]
          expected_vault: string | null
          found: boolean | null
          found_location: string | null
          id: string
          inventory_item_id: string
          is_demo: boolean
          notes: string | null
          reason: string | null
          resolution_notes: string | null
          resolution_outcome: string | null
          resolved_at: string | null
          resolved_by: string | null
          result: string | null
          version: number
        }
        Insert: {
          audit_id: string
          checked_at?: string | null
          checked_by?: string | null
          expected_status: Database["public"]["Enums"]["inventory_status"]
          expected_vault?: string | null
          found: boolean | null
          found_location?: string | null
          id?: string
          inventory_item_id: string
          is_demo?: boolean
          notes?: string | null
          reason?: string | null
          resolution_notes?: string | null
          resolution_outcome?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          result?: string | null
          version?: number
        }
        Update: {
          audit_id?: string
          checked_at?: string | null
          checked_by?: string | null
          expected_status?: Database["public"]["Enums"]["inventory_status"]
          expected_vault?: string | null
          found?: boolean | null
          found_location?: string | null
          id?: string
          inventory_item_id?: string
          is_demo?: boolean
          notes?: string | null
          reason?: string | null
          resolution_notes?: string | null
          resolution_outcome?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          result?: string | null
          version?: number
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
            foreignKeyName: "physical_inventory_audit_items_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_inventory_audit_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_inventory_audit_items_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          expected_count: number | null
          id: string
          is_demo: boolean
          is_partial: boolean
          notes: string | null
          overlap_reason: string | null
          overlaps_with: string[] | null
          performed_by: string | null
          request_id: string | null
          scope_vault: string | null
          started_at: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          discrepancy_count?: number
          expected_count?: number | null
          id?: string
          is_demo?: boolean
          is_partial?: boolean
          notes?: string | null
          overlap_reason?: string | null
          overlaps_with?: string[] | null
          performed_by?: string | null
          request_id?: string | null
          scope_vault?: string | null
          started_at?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          discrepancy_count?: number
          expected_count?: number | null
          id?: string
          is_demo?: boolean
          is_partial?: boolean
          notes?: string | null
          overlap_reason?: string | null
          overlaps_with?: string[] | null
          performed_by?: string | null
          request_id?: string | null
          scope_vault?: string | null
          started_at?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "physical_inventory_audits_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
          is_demo: boolean
          role: Database["public"]["Enums"]["staff_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          is_demo?: boolean
          role?: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
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
          contact_method: Database["public"]["Enums"]["reminder_method"] | null
          created_by: string | null
          id: string
          is_demo: boolean
          loan_id: string
          notes: string | null
          outcome: Database["public"]["Enums"]["reminder_outcome"] | null
          sent_at: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          contact_method?: Database["public"]["Enums"]["reminder_method"] | null
          created_by?: string | null
          id?: string
          is_demo?: boolean
          loan_id: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["reminder_outcome"] | null
          sent_at?: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          contact_method?: Database["public"]["Enums"]["reminder_method"] | null
          created_by?: string | null
          id?: string
          is_demo?: boolean
          loan_id?: string
          notes?: string | null
          outcome?: Database["public"]["Enums"]["reminder_outcome"] | null
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
          is_demo: boolean
          loan_id: string | null
          reason: string
          resolution_notes: string | null
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
          is_demo?: boolean
          loan_id?: string | null
          reason: string
          resolution_notes?: string | null
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
          is_demo?: boolean
          loan_id?: string | null
          reason?: string
          resolution_notes?: string | null
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
      vault_locations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_locations_created_by_fkey"
            columns: ["created_by"]
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
          p_expected_updated_at?: string
          p_first_name?: string
          p_full_name: string
          p_id: string
          p_id_number: string
          p_id_type: string
          p_last_name?: string
          p_middle_name?: string
          p_reason: string
          p_suffix?: string
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
      auction_lines: {
        Args: { p_batch?: string; p_kind: string; p_page?: number; p_q?: string; p_size?: number }
        Returns: Json
      }
      auction_prepare_list: { Args: never; Returns: Json }
      audit_followup_list: { Args: { p_limit?: number }; Returns: Json }
      audit_followups_for: { Args: { p_audit: string }; Returns: Json }
      audit_log_page: {
        Args: {
          p_action?: string
          p_by?: string
          p_find?: string
          p_find_kind?: string
          p_from?: string
          p_kind?: string
          p_page?: number
          p_size?: number
          p_table?: string
          p_to?: string
        }
        Returns: Json
      }
      audit_open_overlaps: { Args: never; Returns: Json }
      audit_scope_options: { Args: never; Returns: Json }
      audit_session_page: {
        Args: {
          p_audit: string
          p_page?: number
          p_q?: string
          p_size?: number
          p_vault?: string
          p_view?: string
        }
        Returns: Json
      }
      cash_ledger_page: {
        Args: {
          p_check?: boolean
          p_flow?: string
          p_from?: string
          p_page?: number
          p_q?: string
          p_size?: number
          p_source?: string
          p_to?: string
          p_type?: string
        }
        Returns: Json
      }
      capitalize_loan: {
        Args: {
          p_expected_maturity?: string
          p_loan_id: string
          p_request_id?: string
        }
        Returns: Json
      }
      create_auction_batch: {
        Args: {
          p_auction_date?: string
          p_auction_place?: string
          p_item_ids: string[]
          p_min_prices?: (number | null)[]
          p_no_reserve?: boolean[]
          p_notes?: string
          p_request_id?: string
        }
        Returns: string
      }
      create_pawn_loan:
        | {
            Args: {
              p_appraisal_item_id: string
              p_customer_id: string
              p_principal_amount: number
              p_request_id?: string
              p_vault_location?: string
            }
            Returns: string
          }
        | {
            Args: {
              p_appraisal_item_id: string
              p_created_by: string
              p_customer_id: string
              p_grace_period_days: number
              p_interest_rate_percent: number
              p_loan_date: string
              p_maturity_date: string
              p_principal_amount: number
              p_ticket_number: string
              p_vault_location: string
            }
            Returns: string
          }
      ctm_accrue_interest: {
        Args: { p_loan: string }
        Returns: {
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
          is_demo: boolean
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
        SetofOptions: {
          from: "*"
          to: "loans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ctm_assert_role: {
        Args: { allowed: Database["public"]["Enums"]["staff_role"][] }
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      ctm_default_detection_core: { Args: never; Returns: number }
      ctm_is_system: { Args: never; Returns: boolean }
      ctm_log_admin_edit: {
        Args: {
          p_after: Json
          p_before: Json
          p_id: string
          p_reason: string
          p_table: string
        }
        Returns: undefined
      }
      ctm_norm_id: { Args: { v: string }; Returns: string }
      ctm_receipt_number: { Args: never; Returns: string }
      ctm_request_seen: {
        Args: { p_kind: string; p_loan_id: string; p_request_id: string }
        Returns: Json
      }
      ctm_selftest: {
        Args: never
        Returns: {
          outcome: string
          test: string
        }[]
      }
      ctm_selftest_0026: {
        Args: never
        Returns: {
          outcome: string
          test: string
        }[]
      }
      ctm_selftest_0027: {
        Args: never
        Returns: {
          outcome: string
          test: string
        }[]
      }
      ctm_selftest_0028: {
        Args: never
        Returns: {
          outcome: string
          test: string
        }[]
      }
      ctm_selftest_0029: {
        Args: never
        Returns: {
          outcome: string
          test: string
        }[]
      }
      ctm_selftest_0031: {
        Args: never
        Returns: {
          outcome: string
          test: string
        }[]
      }
      ctm_selftest_0032: {
        Args: never
        Returns: {
          outcome: string
          test: string
        }[]
      }
      ctm_selftest_0033: {
        Args: never
        Returns: {
          outcome: string
          test: string
        }[]
      }
      ctm_selftest_0034: {
        Args: never
        Returns: {
          outcome: string
          test: string
        }[]
      }
      ctm_selftest_decisions: {
        Args: never
        Returns: {
          outcome: string
          test: string
        }[]
      }
      ctm_selftest_lifecycle: {
        Args: never
        Returns: {
          outcome: string
          test: string
        }[]
      }
      ctm_selftest_review: {
        Args: never
        Returns: {
          outcome: string
          test: string
        }[]
      }
      ctm_customer_score: { Args: { p_customer: string }; Returns: number }
      ctm_loan_terms: {
        Args: { p_principal: number }
        Returns: {
          grace_period_days: number
          interest: number
          interest_rate_percent: number
          maturity_date: string
        }[]
      }
      ctm_photo_in_use: { Args: { p_name: string }; Returns: boolean }
      ctm_in_custody: {
        Args: { s: Database["public"]["Enums"]["inventory_status"] }
        Returns: boolean
      }
      ctm_rate_check: { Args: { p_kind: string }; Returns: boolean }
      ctm_today: { Args: never; Returns: string }
      ctm_unused_photos: {
        Args: { p_older_than?: string }
        Returns: { name: string }[]
      }
      discard_audit_session: {
        Args: { p_audit: string; p_confirm_checks?: boolean; p_reason: string }
        Returns: undefined
      }
      forfeit_loan: { Args: { p_loan_id: string }; Returns: undefined }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      is_admin: { Args: never; Returns: boolean }
      log_reminder: {
        Args: {
          p_loan_id: string
          p_method: Database["public"]["Enums"]["reminder_method"]
          p_notes: string
          p_outcome: Database["public"]["Enums"]["reminder_outcome"]
        }
        Returns: string
      }
      preview_pawn_loan: {
        Args: { p_appraisal_item_id: string; p_principal_amount: number }
        Returns: {
          interest: number
          interest_rate_percent: number
          max_loan: number
          maturity_date: string
          redeem_on_time: number
        }[]
      }
      mark_auction_unsold: { Args: { p_item_id: string; p_reason: string }; Returns: undefined }
      record_auction_sale: {
        Args: {
          p_buyer?: string
          p_item_id: string
          p_notes?: string
          p_request_id?: string
          p_sale_price: number
        }
        Returns: Json
      }
      review_suspicious_flag: {
        Args: { p_decision: string; p_expected_status?: string; p_flag: string; p_notes?: string }
        Returns: Json
      }
      record_cash_entry: {
        Args: { p_amount: number; p_description: string; p_request_id?: string; p_type: string }
        Returns: string
      }
      record_payment: {
        Args: {
          p_amount: number
          p_id_confirm?: string
          p_loan_id: string
          p_lost_ticket?: boolean
          p_request_id?: string
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
      report_cash_breakdown: { Args: { p_from: string; p_to: string }; Returns: Json }
      report_inventory_aging: {
        Args: { p_band?: string; p_custody?: string; p_page?: number; p_size?: number }
        Returns: Json
      }
      report_loan_analytics: { Args: never; Returns: Json }
      report_loans: {
        Args: { p_filter?: string; p_page?: number; p_q?: string; p_report: string; p_size?: number }
        Returns: Json
      }
      reminder_queue: {
        Args: { p_lead_days?: number }
        Returns: {
          customer_id: string
          id: string
          logs: Json
          maturity_date: string
        }[]
      }
      renew_loan: {
        Args: {
          p_expected_maturity?: string
          p_loan_id: string
          p_request_id?: string
        }
        Returns: Json
      }
      record_audit_result: {
        Args: {
          p_found_location?: string
          p_line: string
          p_note?: string
          p_reason?: string
          p_result: string
          p_version: number
        }
        Returns: number
      }
      resolve_audit_item: {
        Args: { p_line_id: string; p_notes: string }
        Returns: undefined
      }
      restore_record: {
        Args: { p_id: string; p_table: string }
        Returns: undefined
      }
      reveal_customer_id: { Args: { p_customer_id: string }; Returns: string }
      run_default_detection: { Args: never; Returns: number }
      run_default_detection_job: { Args: never; Returns: number }
      search_customers_fuzzy: {
        Args: { p_limit?: number; p_q: string }
        Returns: { id: string; similarity: number }[]
      }
      set_appraisal_customer: {
        Args: {
          p_appraisal_id: string
          p_customer_id: string
          p_expected_updated_at?: string
        }
        Returns: undefined
      }
      review_audit_discrepancy: {
        Args: {
          p_found_location?: string
          p_line: string
          p_notes: string
          p_outcome: string
          p_seen?: number
        }
        Returns: Json
      }
      set_auction_reserve: {
        Args: { p_line: string; p_min_price: number | null; p_no_reserve: boolean }
        Returns: undefined
      }
      suspicious_flag_page: {
        Args: { p_page?: number; p_q?: string; p_size?: number; p_status?: string; p_view?: string }
        Returns: Json
      }
      start_inventory_audit: {
        Args: {
          p_overlap_reason?: string
          p_request_id?: string
          p_scope?: string
        }
        Returns: string
      }
      submit_audit_session: {
        Args: { p_audit: string; p_notes?: string; p_partial: boolean }
        Returns: Json
      }
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
        | "sold"
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
      reminder_method: "call" | "sms" | "in_person" | "other"
      reminder_outcome:
        | "reached"
        | "message_sent"
        | "no_answer"
        | "wrong_number"
        | "follow_up"
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

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      aml_status: ["clear", "flagged"],
      appraisal_status: ["available", "pawned"],
      cash_flow_direction: ["in", "out"],
      cash_flow_type: [
        "loan_disbursement",
        "payment_received",
        "expense",
        "revenue",
        "forfeiture",
        "adjustment",
        "capitalization",
      ],
      counterfeit_resolution: ["pending", "cleared", "confirmed"],
      extension_type: ["renewal", "capitalized"],
      inventory_status: [
        "pawned",
        "extended",
        "redeemed",
        "forfeited",
        "queued_for_auction",
        "sold",
      ],
      item_category: [
        "earrings",
        "ring",
        "pendant",
        "chain",
        "bracelet",
        "pendant_with_chain",
        "others",
      ],
      loan_status: [
        "active",
        "extended",
        "redeemed",
        "defaulted",
        "forfeited",
        "reinstated",
      ],
      reminder_method: ["call", "sms", "in_person", "other"],
      reminder_outcome: [
        "reached",
        "message_sent",
        "no_answer",
        "wrong_number",
        "follow_up",
      ],
      staff_role: ["admin", "operator", "cashier", "appraiser"],
      suspicious_flag_status: [
        "open",
        "dismissed",
        "investigating",
        "blacklisted",
      ],
    },
  },
} as const
