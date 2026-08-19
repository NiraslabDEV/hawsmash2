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
          created_at: string
          customer_phone: string | null
          id: number
          payload: Json
          session_id: string
          store_id: string | null
          type: string
          utm: Json
          value_cents: number | null
        }
        Insert: {
          created_at?: string
          customer_phone?: string | null
          id?: number
          payload?: Json
          session_id: string
          store_id?: string | null
          type: string
          utm?: Json
          value_cents?: number | null
        }
        Update: {
          created_at?: string
          customer_phone?: string | null
          id?: number
          payload?: Json
          session_id?: string
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
      cash_sessions: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          counted_cash_cents: number | null
          created_at: string
          difference_cents: number | null
          expected_cash_cents: number | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          report: Json
          store_id: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          counted_cash_cents?: number | null
          created_at?: string
          difference_cents?: number | null
          expected_cash_cents?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          report?: Json
          store_id?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          counted_cash_cents?: number | null
          created_at?: string
          difference_cents?: number | null
          expected_cash_cents?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          report?: Json
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
          store_id: string
          type: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          id?: number
          order_id?: string | null
          payload?: Json
          store_id?: string
          type: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          id?: number
          order_id?: string | null
          payload?: Json
          store_id?: string
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
        }
        Insert: {
          accepting_orders?: boolean
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
        }
        Update: {
          accepting_orders?: boolean
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
      adjust_stock: {
        Args: {
          p_adjusted_by?: string
          p_menu_item_id: string
          p_new_qty: number
          p_reason: string
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
      close_cash_session: {
        Args: { p_counted_cents: number; p_notes?: string }
        Returns: Json
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
      create_counter_sale_without_tickets: {
        Args: { p_payload: Json }
        Returns: Json
      }
      create_order: {
        Args: { p_payload: Json; p_store_slug: string }
        Returns: string
      }
      get_cash_dashboard: { Args: never; Returns: Json }
      get_customer_orders: { Args: { p_phone: string }; Returns: Json }
      get_dashboard_metrics: { Args: { p_period?: string }; Returns: Json }
      get_device_status: { Args: never; Returns: Json }
      get_funnel_metrics: { Args: never; Returns: Json }
      get_menu: {
        Args: { p_channel?: string; p_store_slug: string }
        Returns: Json
      }
      get_order_stats: { Args: never; Returns: Json }
      get_order_status: { Args: { p_order_id: string }; Returns: Json }
      get_orders: { Args: { p_filters?: Json }; Returns: Json }
      get_secret_settings: { Args: never; Returns: Json }
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
      lock_pos_device: { Args: { p_device_id: string }; Returns: Json }
      open_cash_drawer: {
        Args: { p_device_id: string; p_reason: string; p_request_id: string }
        Returns: Json
      }
      open_cash_session: { Args: never; Returns: string }
      pos_pin_status: { Args: { p_device_id: string }; Returns: Json }
      recover_stale_print_jobs: { Args: { p_store_id: string }; Returns: Json }
      reprint: {
        Args: { p_kind: string; p_order_id: string; p_request_id?: string }
        Returns: Json
      }
      set_own_pos_pin: {
        Args: { p_device_id: string; p_pin: string }
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
