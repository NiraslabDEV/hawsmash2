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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      analytics_events: {
        Row: {
          campaign: string | null
          channel: string | null
          created_at: string
          customer_phone: string | null
          id: number
          medium: string | null
          payload: Json
          referrer_host: string | null
          session_id: string
          source: string | null
          store_id: string | null
          type: string
          utm: Json
          value_cents: number | null
        }
        Insert: {
          campaign?: string | null
          channel?: string | null
          created_at?: string
          customer_phone?: string | null
          id?: number
          medium?: string | null
          payload?: Json
          referrer_host?: string | null
          session_id: string
          source?: string | null
          store_id?: string | null
          type: string
          utm?: Json
          value_cents?: number | null
        }
        Update: {
          campaign?: string | null
          channel?: string | null
          created_at?: string
          customer_phone?: string | null
          id?: number
          medium?: string | null
          payload?: Json
          referrer_host?: string | null
          session_id?: string
          source?: string | null
          store_id?: string | null
          type?: string
          utm?: Json
          value_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string
          id: string
          reason: string
          session_id: string
          store_id: string
          type: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by: string
          id?: string
          reason: string
          session_id: string
          store_id: string
          type: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string
          id?: string
          reason?: string
          session_id?: string
          store_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          counted_cash_cents: number | null
          created_at: string
          difference_cents: number | null
          difference_reason: string | null
          expected_cash_cents: number | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          opening_float_cents: number
          report: Json
          shift_label: string
          store_id: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          counted_cash_cents?: number | null
          created_at?: string
          difference_cents?: number | null
          difference_reason?: string | null
          expected_cash_cents?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_float_cents?: number
          report?: Json
          shift_label: string
          store_id?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          counted_cash_cents?: number | null
          created_at?: string
          difference_cents?: number | null
          difference_reason?: string | null
          expected_cash_cents?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_float_cents?: number
          report?: Json
          shift_label?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_jobs: {
        Row: {
          attempts: number
          created_at: string
          destination: string
          event_name: string
          id: number
          last_error: string | null
          next_attempt_at: string
          order_id: string
          response: Json | null
          sent_at: string | null
          status: string
          store_id: string | null
          value_cents: number
        }
        Insert: {
          attempts?: number
          created_at?: string
          destination: string
          event_name?: string
          id?: number
          last_error?: string | null
          next_attempt_at?: string
          order_id: string
          response?: Json | null
          sent_at?: string | null
          status?: string
          store_id?: string | null
          value_cents?: number
        }
        Update: {
          attempts?: number
          created_at?: string
          destination?: string
          event_name?: string
          id?: number
          last_error?: string | null
          next_attempt_at?: string
          order_id?: string
          response?: Json | null
          sent_at?: string | null
          status?: string
          store_id?: string | null
          value_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversion_jobs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_jobs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          address: string
          created_at: string
          customer_phone: string
          delivery_zone_id: string | null
          id: string
          is_default: boolean
          label: string
          notes: string
          updated_at: string
        }
        Insert: {
          address: string
          created_at?: string
          customer_phone: string
          delivery_zone_id?: string | null
          id?: string
          is_default?: boolean
          label: string
          notes?: string
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          customer_phone?: string
          delivery_zone_id?: string | null
          id?: string
          is_default?: boolean
          label?: string
          notes?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_phone_fkey"
            columns: ["customer_phone"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["phone"]
          },
          {
            foreignKeyName: "customer_addresses_delivery_zone_id_fkey"
            columns: ["delivery_zone_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_devices: {
        Row: {
          created_at: string
          customer_phone: string
          id: string
          label: string
          last_seen_at: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          customer_phone: string
          id?: string
          label?: string
          last_seen_at?: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          customer_phone?: string
          id?: string
          label?: string
          last_seen_at?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_devices_customer_phone_fkey"
            columns: ["customer_phone"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["phone"]
          },
        ]
      }
      customer_login_codes: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          expires_at: string
          phone: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          expires_at: string
          phone: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          expires_at?: string
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_login_codes_phone_fkey"
            columns: ["phone"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["phone"]
          },
        ]
      }
      customers: {
        Row: {
          first_seen_at: string
          last_seen_at: string
          name: string | null
          orders_count: number
          phone: string
          total_spent_cents: number
        }
        Insert: {
          first_seen_at?: string
          last_seen_at?: string
          name?: string | null
          orders_count?: number
          phone: string
          total_spent_cents?: number
        }
        Update: {
          first_seen_at?: string
          last_seen_at?: string
          name?: string | null
          orders_count?: number
          phone?: string
          total_spent_cents?: number
        }
        Relationships: []
      }
      delivery_zones: {
        Row: {
          active: boolean
          fee_cents: number
          id: string
          name: string
          sort: number
          store_id: string
        }
        Insert: {
          active?: boolean
          fee_cents: number
          id?: string
          name: string
          sort?: number
          store_id: string
        }
        Update: {
          active?: boolean
          fee_cents?: number
          id?: string
          name?: string
          sort?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_zones_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      device_heartbeats: {
        Row: {
          id: string
          kind: string
          last_seen_at: string
        }
        Insert: {
          id: string
          kind: string
          last_seen_at?: string
        }
        Update: {
          id?: string
          kind?: string
          last_seen_at?: string
        }
        Relationships: []
      }
      devices: {
        Row: {
          active: boolean
          app_version: string | null
          created_at: string
          created_by: string | null
          device_key_hash: string
          id: string
          kind: string
          label: string
          last_seen_at: string | null
          locked_at: string | null
          store_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          app_version?: string | null
          created_at?: string
          created_by?: string | null
          device_key_hash: string
          id?: string
          kind: string
          label: string
          last_seen_at?: string | null
          locked_at?: string | null
          store_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          app_version?: string | null
          created_at?: string
          created_by?: string | null
          device_key_hash?: string
          id?: string
          kind?: string
          label?: string
          last_seen_at?: string | null
          locked_at?: string | null
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      event_log: {
        Row: {
          actor_user_id: string | null
          created_at: string
          id: number
          order_id: string | null
          payload: Json
          store_id: string | null
          type: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          id?: number
          order_id?: string | null
          payload?: Json
          store_id?: string | null
          type: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          id?: number
          order_id?: string | null
          payload?: Json
          store_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_log_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_movements: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: string
          ingredient_id: string
          note: string | null
          order_id: string | null
          qty_after: number
          reason: string
          store_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          ingredient_id: string
          note?: string | null
          order_id?: string | null
          qty_after: number
          reason: string
          store_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          ingredient_id?: string
          note?: string | null
          order_id?: string | null
          qty_after?: number
          reason?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_movements_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_movements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          active: boolean
          cost_cents: number
          created_at: string
          id: string
          name: string
          sort: number
          unit: string
        }
        Insert: {
          active?: boolean
          cost_cents?: number
          created_at?: string
          id?: string
          name: string
          sort?: number
          unit?: string
        }
        Update: {
          active?: boolean
          cost_cents?: number
          created_at?: string
          id?: string
          name?: string
          sort?: number
          unit?: string
        }
        Relationships: []
      }
      menu_addons: {
        Row: {
          active: boolean
          created_at: string
          id: string
          menu_item_id: string
          name: string
          price_cents: number
          sort: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          menu_item_id: string
          name: string
          price_cents: number
          sort?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          menu_item_id?: string
          name?: string
          price_cents?: number
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_addons_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          active: boolean
          id: string
          name: string
          parent_id: string | null
          photo_url: string | null
          sort: number
          station: string
        }
        Insert: {
          active?: boolean
          id?: string
          name: string
          parent_id?: string | null
          photo_url?: string | null
          sort?: number
          station?: string
        }
        Update: {
          active?: boolean
          id?: string
          name?: string
          parent_id?: string | null
          photo_url?: string | null
          sort?: number
          station?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_variants: {
        Row: {
          active: boolean
          created_at: string
          id: string
          is_default: boolean
          menu_item_id: string
          name: string
          photo_url: string | null
          price_cents: number
          sort: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          menu_item_id: string
          name: string
          photo_url?: string | null
          price_cents: number
          sort?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          menu_item_id?: string
          name?: string
          photo_url?: string | null
          price_cents?: number
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_variants_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          allergens: string[]
          available: boolean
          available_delivery: boolean
          available_dine_in: boolean
          calories_kcal: number | null
          category_id: string | null
          description: string | null
          id: string
          is_gift: boolean
          is_upsell: boolean
          name: string
          photo_url: string | null
          price_cents: number
          sort: number
          stock_qty: number | null
          track_stock: boolean
          updated_at: string
        }
        Insert: {
          allergens?: string[]
          available?: boolean
          available_delivery?: boolean
          available_dine_in?: boolean
          calories_kcal?: number | null
          category_id?: string | null
          description?: string | null
          id?: string
          is_gift?: boolean
          is_upsell?: boolean
          name: string
          photo_url?: string | null
          price_cents: number
          sort?: number
          stock_qty?: number | null
          track_stock?: boolean
          updated_at?: string
        }
        Update: {
          allergens?: string[]
          available?: boolean
          available_delivery?: boolean
          available_dine_in?: boolean
          calories_kcal?: number | null
          category_id?: string | null
          description?: string | null
          id?: string
          is_gift?: boolean
          is_upsell?: boolean
          name?: string
          photo_url?: string | null
          price_cents?: number
          sort?: number
          stock_qty?: number | null
          track_stock?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_modifier_groups: {
        Row: {
          active: boolean
          created_at: string
          extra_price_cents: number
          free_quantity: number
          id: string
          max_select: number
          menu_item_id: string
          min_select: number
          name: string
          selection_type: string
          sort: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          extra_price_cents?: number
          free_quantity?: number
          id?: string
          max_select?: number
          menu_item_id: string
          min_select?: number
          name: string
          selection_type?: string
          sort?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          extra_price_cents?: number
          free_quantity?: number
          id?: string
          max_select?: number
          menu_item_id?: string
          min_select?: number
          name?: string
          selection_type?: string
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_modifier_groups_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_modifier_options: {
        Row: {
          active: boolean
          created_at: string
          group_id: string
          id: string
          name: string
          price_cents: number
          sort: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          group_id: string
          id?: string
          name: string
          price_cents?: number
          sort?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          group_id?: string
          id?: string
          name?: string
          price_cents?: number
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_modifier_options_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "menu_modifier_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      order_attribution: {
        Row: {
          campaign: string | null
          channel: string
          click_ids: Json
          client_ip: string | null
          content: string | null
          created_at: string
          event_source_url: string | null
          fbp: string | null
          first_campaign: string | null
          first_channel: string | null
          first_source: string | null
          first_touch: Json | null
          landing_path: string | null
          last_touch: Json | null
          medium: string
          order_id: string
          referrer_host: string | null
          session_id: string | null
          source: string
          store_id: string | null
          term: string | null
          user_agent: string | null
        }
        Insert: {
          campaign?: string | null
          channel?: string
          click_ids?: Json
          client_ip?: string | null
          content?: string | null
          created_at?: string
          event_source_url?: string | null
          fbp?: string | null
          first_campaign?: string | null
          first_channel?: string | null
          first_source?: string | null
          first_touch?: Json | null
          landing_path?: string | null
          last_touch?: Json | null
          medium?: string
          order_id: string
          referrer_host?: string | null
          session_id?: string | null
          source?: string
          store_id?: string | null
          term?: string | null
          user_agent?: string | null
        }
        Update: {
          campaign?: string | null
          channel?: string
          click_ids?: Json
          client_ip?: string | null
          content?: string | null
          created_at?: string
          event_source_url?: string | null
          fbp?: string | null
          first_campaign?: string | null
          first_channel?: string | null
          first_source?: string | null
          first_touch?: Json | null
          landing_path?: string | null
          last_touch?: Json | null
          medium?: string
          order_id?: string
          referrer_host?: string | null
          session_id?: string | null
          source?: string
          store_id?: string | null
          term?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_attribution_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_attribution_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_counters: {
        Row: {
          day: string
          seq: number
          store_id: string
        }
        Insert: {
          day: string
          seq?: number
          store_id: string
        }
        Update: {
          day?: string
          seq?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_counters_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_feedback: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          order_id: string | null
          rating: number
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          rating: number
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_feedback_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          addons: Json
          cost_cents: number | null
          id: string
          menu_item_id: string | null
          modifiers: Json
          name_snapshot: string
          notes: string | null
          order_id: string
          person_label: string | null
          qty: number
          station: string
          store_id: string
          unit_price_cents: number
          variant_name_snapshot: string | null
        }
        Insert: {
          addons?: Json
          cost_cents?: number | null
          id?: string
          menu_item_id?: string | null
          modifiers?: Json
          name_snapshot: string
          notes?: string | null
          order_id: string
          person_label?: string | null
          qty: number
          station: string
          store_id?: string
          unit_price_cents: number
          variant_name_snapshot?: string | null
        }
        Update: {
          addons?: Json
          cost_cents?: number | null
          id?: string
          menu_item_id?: string | null
          modifiers?: Json
          name_snapshot?: string
          notes?: string | null
          order_id?: string
          person_label?: string | null
          qty?: number
          station?: string
          store_id?: string
          unit_price_cents?: number
          variant_name_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address: string | null
          cash_received_cents: number | null
          change_cents: number | null
          channel: string
          client_sale_id: string | null
          created_at: string
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          daily_number: number | null
          delivery_fee_cents: number
          delivery_zone_id: string | null
          discount_cents: number
          flow: string
          fulfillment_type: string
          gift_item_id: string | null
          id: string
          needs_review: boolean
          notes: string | null
          offline_total_cents: number | null
          order_number: string
          payment_method: string
          payment_proof_path: string | null
          payment_provider_ref: string | null
          referral_code: string | null
          scheduled_for: string | null
          status: string
          store_id: string
          subtotal_cents: number
          table_id: string | null
          total_cents: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          cash_received_cents?: number | null
          change_cents?: number | null
          channel: string
          client_sale_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          daily_number?: number | null
          delivery_fee_cents?: number
          delivery_zone_id?: string | null
          discount_cents?: number
          flow: string
          fulfillment_type: string
          gift_item_id?: string | null
          id?: string
          needs_review?: boolean
          notes?: string | null
          offline_total_cents?: number | null
          order_number: string
          payment_method: string
          payment_proof_path?: string | null
          payment_provider_ref?: string | null
          referral_code?: string | null
          scheduled_for?: string | null
          status: string
          store_id?: string
          subtotal_cents: number
          table_id?: string | null
          total_cents: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          cash_received_cents?: number | null
          change_cents?: number | null
          channel?: string
          client_sale_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          daily_number?: number | null
          delivery_fee_cents?: number
          delivery_zone_id?: string | null
          discount_cents?: number
          flow?: string
          fulfillment_type?: string
          gift_item_id?: string | null
          id?: string
          needs_review?: boolean
          notes?: string | null
          offline_total_cents?: number | null
          order_number?: string
          payment_method?: string
          payment_proof_path?: string | null
          payment_provider_ref?: string | null
          referral_code?: string | null
          scheduled_for?: string | null
          status?: string
          store_id?: string
          subtotal_cents?: number
          table_id?: string | null
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_delivery_zone_id_fkey"
            columns: ["delivery_zone_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          idempotency_key: string
          method: string | null
          order_id: string
          provider: string
          provider_ref: string | null
          raw_webhook: Json | null
          status: string
          store_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          idempotency_key: string
          method?: string | null
          order_id: string
          provider: string
          provider_ref?: string | null
          raw_webhook?: Json | null
          status?: string
          store_id?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          method?: string | null
          order_id?: string
          provider?: string
          provider_ref?: string | null
          raw_webhook?: Json | null
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      print_jobs: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          id: string
          kind: string
          order_id: string | null
          payload: Json
          printed_at: string | null
          reprint_seq: number
          request_id: string | null
          station: string
          status: string
          store_id: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          id?: string
          kind?: string
          order_id?: string | null
          payload?: Json
          printed_at?: string | null
          reprint_seq?: number
          request_id?: string | null
          station: string
          status?: string
          store_id?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          id?: string
          kind?: string
          order_id?: string | null
          payload?: Json
          printed_at?: string | null
          reprint_seq?: number
          request_id?: string | null
          station?: string
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_jobs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          action: string
          attempt_count: number
          id: string
          last_attempt: string
        }
        Insert: {
          action: string
          attempt_count?: number
          id: string
          last_attempt?: string
        }
        Update: {
          action?: string
          attempt_count?: number
          id?: string
          last_attempt?: string
        }
        Relationships: []
      }
      recipe_items: {
        Row: {
          created_at: string
          id: string
          ingredient_id: string
          menu_item_id: string
          qty: number
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_id: string
          menu_item_id: string
          qty: number
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_id?: string
          menu_item_id?: string
          qty?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "menu_item_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          expires_at: string | null
          gift_item_id: string | null
          id: string
          max_redemptions: number
          owner_name: string
          owner_phone: string | null
          referrer_reward_cents: number
          reward_type: string
          reward_value: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          expires_at?: string | null
          gift_item_id?: string | null
          id?: string
          max_redemptions?: number
          owner_name?: string
          owner_phone?: string | null
          referrer_reward_cents?: number
          reward_type: string
          reward_value?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          expires_at?: string | null
          gift_item_id?: string | null
          id?: string
          max_redemptions?: number
          owner_name?: string
          owner_phone?: string | null
          referrer_reward_cents?: number
          reward_type?: string
          reward_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "referral_codes_gift_item_id_fkey"
            columns: ["gift_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_redemptions: {
        Row: {
          code_id: string
          created_at: string
          customer_phone: string
          id: string
          order_id: string
        }
        Insert: {
          code_id: string
          created_at?: string
          customer_phone: string
          id?: string
          order_id: string
        }
        Update: {
          code_id?: string
          created_at?: string
          customer_phone?: string
          id?: string
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_redemptions_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          accepting_orders: boolean
          cash_diff_tolerance_cents: number
          close_hour: number
          emola_name: string | null
          emola_number: string | null
          ga4_measurement_id: string | null
          gads_conversion_id: string | null
          gads_conversion_label: string | null
          gads_developer_token: string | null
          gift_goal_cents: number | null
          gift_goal_item_id: string | null
          gtm_container_id: string | null
          id: number
          meta_capi_token: string | null
          meta_pixel_id: string | null
          mpesa_name: string | null
          mpesa_number: string | null
          open_hour: number
          owner_email: string | null
          payment_provider: string
          paysuite_api_key: string | null
          paysuite_webhook_secret: string | null
          pickup_address: string | null
          pickup_maps_url: string | null
          promo_banner_url: string | null
          promo_code: string | null
          slot_minutes: number
          upsell_enabled: boolean
          upsell_subtitle: string
          upsell_title: string
        }
        Insert: {
          accepting_orders?: boolean
          cash_diff_tolerance_cents?: number
          close_hour?: number
          emola_name?: string | null
          emola_number?: string | null
          ga4_measurement_id?: string | null
          gads_conversion_id?: string | null
          gads_conversion_label?: string | null
          gads_developer_token?: string | null
          gift_goal_cents?: number | null
          gift_goal_item_id?: string | null
          gtm_container_id?: string | null
          id?: number
          meta_capi_token?: string | null
          meta_pixel_id?: string | null
          mpesa_name?: string | null
          mpesa_number?: string | null
          open_hour?: number
          owner_email?: string | null
          payment_provider?: string
          paysuite_api_key?: string | null
          paysuite_webhook_secret?: string | null
          pickup_address?: string | null
          pickup_maps_url?: string | null
          promo_banner_url?: string | null
          promo_code?: string | null
          slot_minutes?: number
          upsell_enabled?: boolean
          upsell_subtitle?: string
          upsell_title?: string
        }
        Update: {
          accepting_orders?: boolean
          cash_diff_tolerance_cents?: number
          close_hour?: number
          emola_name?: string | null
          emola_number?: string | null
          ga4_measurement_id?: string | null
          gads_conversion_id?: string | null
          gads_conversion_label?: string | null
          gads_developer_token?: string | null
          gift_goal_cents?: number | null
          gift_goal_item_id?: string | null
          gtm_container_id?: string | null
          id?: number
          meta_capi_token?: string | null
          meta_pixel_id?: string | null
          mpesa_name?: string | null
          mpesa_number?: string | null
          open_hour?: number
          owner_email?: string | null
          payment_provider?: string
          paysuite_api_key?: string | null
          paysuite_webhook_secret?: string | null
          pickup_address?: string | null
          pickup_maps_url?: string | null
          promo_banner_url?: string | null
          promo_code?: string | null
          slot_minutes?: number
          upsell_enabled?: boolean
          upsell_subtitle?: string
          upsell_title?: string
        }
        Relationships: []
      }
      staff_profiles: {
        Row: {
          active: boolean
          created_at: string
          full_name: string
          pin_hash: string | null
          role: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          full_name: string
          pin_hash?: string | null
          role: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          full_name?: string
          pin_hash?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      staff_stores: {
        Row: {
          store_id: string
          user_id: string
        }
        Insert: {
          store_id: string
          user_id: string
        }
        Update: {
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_stores_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: string
          menu_item_id: string
          note: string | null
          order_id: string | null
          qty_after: number
          reason: string
          store_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          menu_item_id: string
          note?: string | null
          order_id?: string | null
          qty_after: number
          reason: string
          store_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          menu_item_id?: string
          note?: string | null
          order_id?: string | null
          qty_after?: number
          reason?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_hours: {
        Row: {
          active: boolean
          closes: string
          dow: number
          opens: string
          store_id: string
        }
        Insert: {
          active?: boolean
          closes: string
          dow: number
          opens: string
          store_id: string
        }
        Update: {
          active?: boolean
          closes?: string
          dow?: number
          opens?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_hours_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_ingredients: {
        Row: {
          ingredient_id: string
          low_qty: number
          qty: number
          store_id: string
          track: boolean
        }
        Insert: {
          ingredient_id: string
          low_qty?: number
          qty?: number
          store_id: string
          track?: boolean
        }
        Update: {
          ingredient_id?: string
          low_qty?: number
          qty?: number
          store_id?: string
          track?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "store_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_ingredients_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_items: {
        Row: {
          available: boolean
          low_stock_qty: number
          menu_item_id: string
          price_cents_override: number | null
          stock_qty: number
          store_id: string
          track_stock: boolean
        }
        Insert: {
          available?: boolean
          low_stock_qty?: number
          menu_item_id: string
          price_cents_override?: number | null
          stock_qty?: number
          store_id: string
          track_stock?: boolean
        }
        Update: {
          available?: boolean
          low_stock_qty?: number
          menu_item_id?: string
          price_cents_override?: number | null
          stock_qty?: number
          store_id?: string
          track_stock?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "store_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_order_sequences: {
        Row: {
          seq: number
          store_id: string
        }
        Insert: {
          seq?: number
          store_id: string
        }
        Update: {
          seq?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_order_sequences_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          accepting_orders: boolean
          active: boolean
          address: string | null
          counter_enabled: boolean
          created_at: string
          delivery_enabled: boolean
          emola_name: string | null
          emola_number: string | null
          id: string
          maps_url: string | null
          mpesa_name: string | null
          mpesa_number: string | null
          name: string
          order_prefix: string
          owner_email: string | null
          payment_provider: string
          paysuite_api_key: string | null
          paysuite_webhook_secret: string | null
          phone: string | null
          pickup_enabled: boolean
          receipt_footer: string | null
          receipt_header: string | null
          short_name: string
          slug: string
          sort: number
        }
        Insert: {
          accepting_orders?: boolean
          active?: boolean
          address?: string | null
          counter_enabled?: boolean
          created_at?: string
          delivery_enabled?: boolean
          emola_name?: string | null
          emola_number?: string | null
          id?: string
          maps_url?: string | null
          mpesa_name?: string | null
          mpesa_number?: string | null
          name: string
          order_prefix: string
          owner_email?: string | null
          payment_provider?: string
          paysuite_api_key?: string | null
          paysuite_webhook_secret?: string | null
          phone?: string | null
          pickup_enabled?: boolean
          receipt_footer?: string | null
          receipt_header?: string | null
          short_name: string
          slug: string
          sort?: number
        }
        Update: {
          accepting_orders?: boolean
          active?: boolean
          address?: string | null
          counter_enabled?: boolean
          created_at?: string
          delivery_enabled?: boolean
          emola_name?: string | null
          emola_number?: string | null
          id?: string
          maps_url?: string | null
          mpesa_name?: string | null
          mpesa_number?: string | null
          name?: string
          order_prefix?: string
          owner_email?: string | null
          payment_provider?: string
          paysuite_api_key?: string | null
          paysuite_webhook_secret?: string | null
          phone?: string | null
          pickup_enabled?: boolean
          receipt_footer?: string | null
          receipt_header?: string | null
          short_name?: string
          slug?: string
          sort?: number
        }
        Relationships: []
      }
      tables: {
        Row: {
          active: boolean
          created_at: string
          id: string
          number: number
          token: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          number: number
          token?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          number?: number
          token?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string
        }
        Relationships: []
      }
    }
    Views: {
      funnel_by_source: {
        Row: {
          purchases: number | null
          revenue_cents: number | null
          sessions: number | null
          source: string | null
        }
        Relationships: []
      }
      funnel_rates: {
        Row: {
          pct_checkout_to_payment: number | null
          pct_menu_to_checkout: number | null
          pct_overall: number | null
          pct_payment_to_purchase: number | null
          step_checkout: number | null
          step_menu: number | null
          step_payment: number | null
          step_purchase: number | null
          total_sessions: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _confirmed_orders_in_period: {
        Args: { p_from: string; p_to: string }
        Returns: {
          created_at: string
          delivery_fee_cents: number
          fulfillment_type: string
          id: string
          order_number: string
          payment_method: string
          status: string
          total_cents: number
        }[]
      }
      account_bind_device: { Args: { p_order_id: string }; Returns: Json }
      account_delete_address: {
        Args: { p_id: string; p_token: string }
        Returns: Json
      }
      account_logout: { Args: { p_token: string }; Returns: Json }
      account_me: { Args: { p_token: string }; Returns: Json }
      account_request_code: { Args: { p_phone: string }; Returns: Json }
      account_save_address: {
        Args: {
          p_address?: string
          p_default?: boolean
          p_id?: string
          p_label?: string
          p_notes?: string
          p_token: string
          p_zone_id?: string
        }
        Returns: Json
      }
      account_verify_code: {
        Args: { p_code: string; p_phone: string }
        Returns: Json
      }
      add_cash_movement: {
        Args: {
          p_amount_cents: number
          p_reason: string
          p_store: string
          p_type: string
        }
        Returns: string
      }
      adjust_stock: {
        Args: {
          p_adjusted_by?: string
          p_menu_item_id: string
          p_new_qty: number
          p_reason: string
        }
        Returns: Json
      }
      adjust_store_ingredient: {
        Args: {
          p_delta?: number
          p_ingredient_id: string
          p_new_qty?: number
          p_note?: string
          p_reason: string
          p_store_id: string
        }
        Returns: Json
      }
      adjust_store_stock: {
        Args: {
          p_delta?: number
          p_menu_item_id: string
          p_new_qty?: number
          p_note?: string
          p_reason: string
          p_store_id: string
        }
        Returns: Json
      }
      admin_list_feedbacks: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      admin_list_waitlist: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      advance_order: {
        Args: { p_event: string; p_order_id: string; p_reason?: string }
        Returns: Json
      }
      attach_payment_proof: {
        Args: { p_order_id: string; p_path: string }
        Returns: Json
      }
      audit_permissive_policies: {
        Args: never
        Returns: {
          cmd: string
          policy_name: string
          roles: string[]
          table_name: string
        }[]
      }
      bind_pos_device: {
        Args: { p_label: string; p_store_id: string }
        Returns: Json
      }
      bridge_heartbeat: {
        Args: {
          p_app_version?: string
          p_device_id: string
          p_store_id: string
        }
        Returns: Json
      }
      claim_conversion_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          destination: string
          event_name: string
          id: number
          order_id: string
          store_id: string
          value_cents: number
        }[]
      }
      close_cash_session:
        | { Args: { p_counted_cents: number; p_notes?: string }; Returns: Json }
        | {
            Args: { p_counted: number; p_reason: string; p_store: string }
            Returns: Json
          }
      complete_conversion_job: {
        Args: {
          p_error?: string
          p_id: number
          p_ok: boolean
          p_response?: Json
        }
        Returns: undefined
      }
      confirm_payment: {
        Args: {
          p_amount_cents: number
          p_idempotency_key: string
          p_method: string
          p_order_id: string
          p_provider: string
          p_provider_ref: string
          p_raw_webhook?: Json
        }
        Returns: string
      }
      create_counter_sale: { Args: { p_payload: Json }; Returns: Json }
      create_counter_sale_unlocked: { Args: { p_payload: Json }; Returns: Json }
      create_counter_sale_without_drawer: {
        Args: { p_payload: Json }
        Returns: Json
      }
      create_counter_sale_without_recipe: {
        Args: { p_payload: Json }
        Returns: Json
      }
      create_counter_sale_without_tickets: {
        Args: { p_payload: Json }
        Returns: Json
      }
      create_order: {
        Args: { p_payload: Json; p_store_slug: string }
        Returns: string
      }
      deactivate_staff: {
        Args: { p_reason: string; p_user_id: string }
        Returns: Json
      }
      delete_delivery_zone: { Args: { p_zone_id: string }; Returns: Json }
      delete_recipe_item: { Args: { p_id: string }; Returns: Json }
      enqueue_conversions: { Args: { p_order_id: string }; Returns: number }
      export_sales_for_accounting: {
        Args: { p_from?: string; p_store_id?: string; p_to?: string }
        Returns: {
          channel: string
          customer_name: string
          customer_phone: string
          daily_number: number
          delivery_fee_cents: number
          order_number: string
          order_status: string
          order_total_cents: number
          payment_amount_cents: number
          payment_method: string
          payment_reference: string
          payment_status: string
          sale_date: string
          sale_time: string
          store_name: string
          subtotal_cents: number
        }[]
      }
      get_attribution_report: {
        Args: { p_from?: string; p_store_id?: string; p_to?: string }
        Returns: Json
      }
      get_cash_dashboard: { Args: { p_store?: string }; Returns: Json }
      get_conversion_context: { Args: { p_order_id: string }; Returns: Json }
      get_conversion_health: { Args: never; Returns: Json }
      get_customer_orders: { Args: { p_phone: string }; Returns: Json }
      get_daily_digest: { Args: { p_day?: string }; Returns: Json }
      get_dashboard_metrics: {
        Args: { p_period?: string; p_store_id?: string }
        Returns: Json
      }
      get_device_status: { Args: never; Returns: Json }
      get_funnel_metrics: { Args: never; Returns: Json }
      get_menu: {
        Args: {
          p_channel?: string
          p_include_unavailable?: boolean
          p_store_slug: string
        }
        Returns: Json
      }
      get_order_stats: { Args: never; Returns: Json }
      get_order_status: { Args: { p_order_id: string }; Returns: Json }
      get_orders: { Args: { p_filters?: Json }; Returns: Json }
      get_secret_settings: { Args: never; Returns: Json }
      get_store_admin: { Args: { p_store_id: string }; Returns: Json }
      get_store_board: { Args: { p_store_slug: string }; Returns: Json }
      get_store_queue: { Args: { p_store_slug: string }; Returns: Json }
      get_system_status: { Args: never; Returns: Json }
      get_table_by_token: { Args: { p_token: string }; Returns: Json }
      identify_customer: {
        Args: { p_name?: string; p_phone: string }
        Returns: Json
      }
      import_menu: { Args: { p_payload: Json }; Returns: Json }
      join_waitlist: {
        Args: { p_name: string; p_notes?: string; p_phone: string }
        Returns: Json
      }
      list_ingredient_movements: {
        Args: { p_ingredient_id?: string; p_limit?: number; p_store_id: string }
        Returns: Json
      }
      list_public_stores: { Args: never; Returns: Json }
      list_recipes: { Args: never; Returns: Json }
      list_staff: { Args: never; Returns: Json }
      list_stock_alerts: { Args: { p_store_id?: string }; Returns: Json }
      list_stock_movements: {
        Args: {
          p_limit?: number
          p_menu_item_id?: string
          p_offset?: number
          p_store_id: string
        }
        Returns: Json
      }
      list_store_ingredients: { Args: { p_store_id: string }; Returns: Json }
      list_store_stock: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_only_tracked?: boolean
          p_store_id: string
        }
        Returns: Json
      }
      list_system_alerts: { Args: never; Returns: Json }
      lock_pos_device: { Args: { p_device_id: string }; Returns: Json }
      open_cash_drawer: {
        Args: { p_device_id: string; p_reason: string; p_request_id: string }
        Returns: Json
      }
      open_cash_session:
        | { Args: never; Returns: string }
        | { Args: { p_float: number; p_store: string }; Returns: string }
      pos_pin_status: { Args: { p_device_id: string }; Returns: Json }
      record_order_attribution: {
        Args: { p_order_id: string; p_payload: Json }
        Returns: undefined
      }
      record_server_purchase_event: {
        Args: { p_order_id: string; p_value_cents: number }
        Returns: undefined
      }
      recover_stale_print_jobs: { Args: { p_store_id: string }; Returns: Json }
      report_cmv: {
        Args: { p_from: string; p_store_id: string; p_to: string }
        Returns: Json
      }
      reprint: {
        Args: { p_kind: string; p_order_id: string; p_request_id?: string }
        Returns: Json
      }
      save_delivery_zone: {
        Args: { p_store_id: string; p_zone: Json }
        Returns: Json
      }
      save_ingredient: {
        Args: {
          p_active?: boolean
          p_cost_cents: number
          p_id?: string
          p_name: string
          p_sort?: number
          p_unit?: string
        }
        Returns: Json
      }
      save_recipe_item: {
        Args: {
          p_ingredient_id: string
          p_menu_item_id: string
          p_qty: number
          p_variant_id?: string
        }
        Returns: Json
      }
      save_store: { Args: { p_payload: Json }; Returns: Json }
      set_ingredient_tracking: {
        Args: {
          p_ingredient_id: string
          p_low_qty?: number
          p_store_id: string
          p_track: boolean
        }
        Returns: Json
      }
      set_own_pos_pin: {
        Args: { p_device_id: string; p_pin: string }
        Returns: Json
      }
      set_staff_access: {
        Args: {
          p_active?: boolean
          p_full_name?: string
          p_role: string
          p_store_ids: string[]
          p_user_id: string
        }
        Returns: Json
      }
      set_staff_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: Json
      }
      set_stock_tracking: {
        Args: {
          p_low_stock_qty?: number
          p_menu_item_id: string
          p_store_id: string
          p_track_stock: boolean
        }
        Returns: Json
      }
      set_store_accepting_orders: {
        Args: { p_accepting: boolean; p_reason?: string; p_store_id: string }
        Returns: Json
      }
      set_store_hours: {
        Args: { p_hours: Json; p_store_id: string }
        Returns: Json
      }
      submit_feedback: {
        Args: {
          p_comment?: string
          p_customer_phone?: string
          p_order_id: string
          p_rating: number
        }
        Returns: Json
      }
      sync_counter_sale: {
        Args: { p_local_print?: Json; p_payload: Json }
        Returns: Json
      }
      unlock_pos_device: {
        Args: { p_device_id: string; p_pin: string }
        Returns: Json
      }
      upsert_heartbeat: {
        Args: { p_device_id: string; p_kind: string }
        Returns: Json
      }
      validate_referral: {
        Args: { p_code: string; p_phone: string }
        Returns: Json
      }
      void_sale: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
