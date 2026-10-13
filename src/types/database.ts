export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      categories: {
        Row: {
          created_at: string
          id: number
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      event_collaborators: {
        Row: {
          added_at: string
          event_id: string
          profile_id: string
          role: string
        }
        Insert: {
          added_at?: string
          event_id: string
          profile_id: string
          role?: string
        }
        Update: {
          added_at?: string
          event_id?: string
          profile_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_collaborators_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collaborators_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "recommended_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collaborators_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "trending_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collaborators_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collaborators_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "recommended_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_collaborators_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "trending_artists"
            referencedColumns: ["id"]
          },
        ]
      }
      event_registrations: {
        Row: {
          created_at: string
          event_id: string
          id: string
          member_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          member_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          member_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "recommended_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "trending_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "recommended_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "trending_artists"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          capacity: number | null
          category_id: number | null
          cover_path: string | null
          created_at: string
          description: string | null
          ends_at: string | null
          host_id: string
          id: string
          price_cents: number
          search_vector: unknown
          starts_at: string
          status: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at: string
        }
        Insert: {
          capacity?: number | null
          category_id?: number | null
          cover_path?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          host_id: string
          id?: string
          price_cents?: number
          search_vector?: unknown
          starts_at: string
          status?: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at?: string
        }
        Update: {
          capacity?: number | null
          category_id?: number | null
          cover_path?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          host_id?: string
          id?: string
          price_cents?: number
          search_vector?: unknown
          starts_at?: string
          status?: Database["public"]["Enums"]["event_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "recommended_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "trending_artists"
            referencedColumns: ["id"]
          },
        ]
      }
      interactions: {
        Row: {
          created_at: string
          id: number
          kind: string
          member_id: string
          subject_id: string
          subject_type: string
        }
        Insert: {
          created_at?: string
          id?: never
          kind?: string
          member_id: string
          subject_id: string
          subject_type: string
        }
        Update: {
          created_at?: string
          id?: never
          kind?: string
          member_id?: string
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "interactions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "recommended_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "trending_artists"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          alt_text: string | null
          bucket: string
          content_type: string
          created_at: string
          height: number | null
          id: string
          path: string
          portfolio_item_id: string
          position: number
          variant: string
          width: number | null
        }
        Insert: {
          alt_text?: string | null
          bucket: string
          content_type: string
          created_at?: string
          height?: number | null
          id?: string
          path: string
          portfolio_item_id: string
          position?: number
          variant?: string
          width?: number | null
        }
        Update: {
          alt_text?: string | null
          bucket?: string
          content_type?: string
          created_at?: string
          height?: number | null
          id?: string
          path?: string
          portfolio_item_id?: string
          position?: number
          variant?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_portfolio_item_id_fkey"
            columns: ["portfolio_item_id"]
            isOneToOne: false
            referencedRelation: "portfolio_items"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount_cents: number
          created_at: string
          gateway: string
          id: string
          member_id: string
          registration_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          gateway?: string
          id?: string
          member_id: string
          registration_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          gateway?: string
          id?: string
          member_id?: string
          registration_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "recommended_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "trending_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "event_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      page_views: {
        Row: {
          id: number
          subject_id: string
          subject_type: string
          viewed_at: string
          viewer_id: string | null
        }
        Insert: {
          id?: never
          subject_id: string
          subject_type: string
          viewed_at?: string
          viewer_id?: string | null
        }
        Update: {
          id?: never
          subject_id?: string
          subject_type?: string
          viewed_at?: string
          viewer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "page_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "recommended_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "trending_artists"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_stub_settings: {
        Row: {
          force_fail: boolean
          id: boolean
        }
        Insert: {
          force_fail?: boolean
          id?: boolean
        }
        Update: {
          force_fail?: boolean
          id?: boolean
        }
        Relationships: []
      }
      portfolio_items: {
        Row: {
          created_at: string
          description: string | null
          id: string
          media_kind: string
          profile_id: string
          published: boolean
          published_at: string | null
          search_vector: unknown
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          media_kind: string
          profile_id: string
          published?: boolean
          published_at?: string | null
          search_vector?: unknown
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          media_kind?: string
          profile_id?: string
          published?: boolean
          published_at?: string | null
          search_vector?: unknown
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_items_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_items_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "recommended_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_items_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "trending_artists"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_kind: Database["public"]["Enums"]["account_kind"]
          avatar_path: string | null
          bio: string | null
          category_id: number | null
          created_at: string
          display_name: string
          handle: string
          id: string
          published: boolean
          search_vector: unknown
          updated_at: string
        }
        Insert: {
          account_kind?: Database["public"]["Enums"]["account_kind"]
          avatar_path?: string | null
          bio?: string | null
          category_id?: number | null
          created_at?: string
          display_name: string
          handle: string
          id: string
          published?: boolean
          search_vector?: unknown
          updated_at?: string
        }
        Update: {
          account_kind?: Database["public"]["Enums"]["account_kind"]
          avatar_path?: string | null
          bio?: string | null
          category_id?: number | null
          created_at?: string
          display_name?: string
          handle?: string
          id?: string
          published?: boolean
          search_vector?: unknown
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      category_affinity: {
        Row: {
          affinity: number | null
          category_id: number | null
          member_id: string | null
        }
        Relationships: []
      }
      like_counts: {
        Row: {
          like_count: number | null
          subject_id: string | null
          subject_type: string | null
        }
        Relationships: []
      }
      recommended_artists: {
        Row: {
          affinity: number | null
          avatar_path: string | null
          category_id: number | null
          display_name: string | null
          handle: string | null
          id: string | null
          published_items: number | null
          view_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      recommended_events: {
        Row: {
          affinity: number | null
          capacity: number | null
          category_id: number | null
          cover_path: string | null
          description: string | null
          ends_at: string | null
          host_id: string | null
          id: string | null
          price_cents: number | null
          starts_at: string | null
          title: string | null
          view_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "recommended_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "trending_artists"
            referencedColumns: ["id"]
          },
        ]
      }
      trending_artists: {
        Row: {
          avatar_path: string | null
          category_id: number | null
          display_name: string | null
          handle: string | null
          id: string | null
          published_items: number | null
          view_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      trending_events: {
        Row: {
          category_id: number | null
          host_id: string | null
          id: string | null
          price_cents: number | null
          starts_at: string | null
          title: string | null
          view_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "recommended_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "trending_artists"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      cancel_registration: {
        Args: { p_registration_id: string }
        Returns: undefined
      }
      is_event_collaborator: {
        Args: { p_event: string; p_member: string }
        Returns: boolean
      }
      is_event_host: {
        Args: { p_event: string; p_member: string }
        Returns: boolean
      }
      record_member_view: {
        Args: { p_subject_id: string; p_subject_type: string }
        Returns: undefined
      }
      record_page_view: {
        Args: { p_subject_id: string; p_subject_type: string }
        Returns: undefined
      }
      register_for_event: { Args: { p_event_id: string }; Returns: string }
      set_payment_stub_force_fail: {
        Args: { p_force_fail: boolean }
        Returns: undefined
      }
      settle_order: { Args: { p_order_id: string }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      toggle_like: {
        Args: { p_subject_id: string; p_subject_type: string }
        Returns: boolean
      }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      account_kind: "individual" | "organisation"
      event_status: "draft" | "published" | "cancelled"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_kind: ["individual", "organisation"],
      event_status: ["draft", "published", "cancelled"],
    },
  },
} as const

