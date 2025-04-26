import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { SupabaseClient } from '@supabase/supabase-js';

// Load environment variables
const env = await config({ safe: true, export: true });

const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_ANON_KEY; // Use ANON key by default
// const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase URL and Key are required in .env file");
}

// Create a single supabase client for interacting with your database
// Use ANON key - assumes RLS is set up properly in Supabase
export const supabase = createClient(supabaseUrl, supabaseKey);

// --- Optional: Service Role Client ---
// If you need to bypass RLS for certain backend operations, create a separate client
// Make sure SUPABASE_SERVICE_ROLE_KEY is set in your .env

let _supabaseAdminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
    if (!_supabaseAdminClient) {
        const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
        if (!serviceKey) {
            throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin operations.");
        }
        _supabaseAdminClient = createClient(supabaseUrl, serviceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });
    }
    return _supabaseAdminClient;
}

console.log("Supabase client initialized."); 