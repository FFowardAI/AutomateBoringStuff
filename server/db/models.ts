/**
 * Database schema definitions based on Supabase tables
 */

// Corresponds to the 'users' table
export interface User {
    id: string; // UUID
    name?: string | null;
    email?: string | null;
    created_at: string; // TIMESTAMPTZ represented as ISO string
}

// Corresponds to the 'sessions' table
export interface Session {
    id: string; // UUID
    user_id: string; // UUID
    context?: string | null;
    started_at: string; // TIMESTAMPTZ
    ended_at?: string | null; // TIMESTAMPTZ
}

// Corresponds to the 'recordings' table
export interface Recording {
    id: string; // UUID
    session_id: string; // UUID
    start_time: string; // TIMESTAMPTZ
    end_time: string; // TIMESTAMPTZ
}

// Corresponds to the 'images' table
export interface Image {
    id: string; // UUID
    recording_id: string; // UUID
    file_path: string;
    sequence?: number | null;
    captured_at: string; // TIMESTAMPTZ
}

// Corresponds to the 'scripts' table
export type ScriptStatus = 'pending' | 'completed' | 'failed';
export interface Script {
    id: string; // UUID
    session_id: string; // UUID
    content: string;
    status: ScriptStatus;
    created_at: string; // TIMESTAMPTZ
}

// Corresponds to the 'activations' table
export interface Activation {
    id: string; // UUID
    user_id: string; // UUID
    script_id: string; // UUID
    context?: string | null;
    activated_at: string; // TIMESTAMPTZ
}

// Corresponds to the 'compute_jobs' table
export type ComputeJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export interface ComputeJob {
    id: string; // UUID
    script_id: string; // UUID
    context?: string | null;
    status: ComputeJobStatus;
    result?: string | null;
    created_at: string; // TIMESTAMPTZ
    updated_at: string; // TIMESTAMPTZ
}

// Corresponds to the 'notifications' table
export type NotificationType = 'script_ready' | 'compute_done' | 'error';
export interface Notification {
    id: string; // UUID
    user_id: string; // UUID
    script_id?: string | null; // UUID
    compute_job_id?: string | null; // UUID
    type: NotificationType;
    message: string;
    is_read: boolean;
    created_at: string; // TIMESTAMPTZ
} 