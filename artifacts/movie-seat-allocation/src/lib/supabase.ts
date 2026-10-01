import { createClient } from "@supabase/supabase-js";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type Database = {
  public: {
    Tables: {
      staff_profiles: Table<{ id: string; full_name: string; created_at: string }>;
      movies: Table<{
        id: string;
        title: string;
        genre: string;
        rating: string;
        duration_minutes: number;
        poster_tone: string;
        created_at: string;
      }>;
      screens: Table<{
        id: string;
        name: string;
        row_count: number;
        seats_per_row: number;
        created_at: string;
      }>;
      seats: Table<{
        id: string;
        screen_id: string;
        row_label: string;
        seat_number: number;
        zone: string;
      }>;
      shows: Table<{
        id: string;
        movie_id: string;
        screen_id: string;
        starts_at: string;
        language: string;
        format: string;
        status: string;
        created_at: string;
      }>;
      group_requests: Table<{
        id: string;
        show_id: string;
        label: string;
        group_size: number;
        preferred_zone: string;
        prefer_together: boolean;
        status: string;
        created_by: string | null;
        created_at: string;
      }>;
      allocations: Table<{
        id: string;
        show_id: string;
        seat_id: string;
        group_request_id: string;
        allocated_by: string | null;
        allocated_at: string;
        released_at: string | null;
      }>;
    };
    Views: { [_ in never]: never };
    Functions: {
      create_screen_with_seats: {
        Args: { p_name: string; p_row_count: number; p_seats_per_row: number };
        Returns: string;
      };
      allocate_group_seats: {
        Args: { p_group_request_id: string; p_seat_ids: string[] };
        Returns: Database["public"]["Tables"]["allocations"]["Row"][];
      };
      release_seat: {
        Args: { p_allocation_id: string };
        Returns: boolean;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;
