/**
 * Database schema definitions based on Supabase tables (using BIGINT/BIGSERIAL)
 */

// Corresponds to the 'users' table
export interface User {
    id: number; // BIGSERIAL
    name: string; // Changed to NOT NULL based on user schema
    email: string; // Changed to NOT NULL based on user schema
    created_at: string; // TIMESTAMPTZ represented as ISO string
    permissions?: string | null;
    role_id?: number | null; // bigint
    organization_id?: number | null; // bigint
}

// Removed Session interface

// Corresponds to the 'recordings' table
export interface Recording {
    id: number; // BIGSERIAL
    user_id: number; // BIGINT (FK to users.id)
    start_time: string; // TIMESTAMPTZ
    end_time: string; // TIMESTAMPTZ
}

// Corresponds to the 'images' table
export interface Image {
    id: number; // BIGSERIAL
    recording_id: number; // BIGINT (FK to recordings.id)
    file_path: string;
    sequence?: number | null;
    captured_at: string; // TIMESTAMPTZ
}

// Corresponds to the 'scripts' table
export type ScriptStatus = 'pending' | 'completed' | 'failed';
export interface Script {
    id: number; // BIGSERIAL
    recording_id: number; // BIGINT (FK to recordings.id)
    content: string;
    status: ScriptStatus;
    created_at: string; // TIMESTAMPTZ
    is_structured?: boolean;
    structured_data?: Record<string, any> | null; // Parsed JSON structure if valid
}

// Corresponds to the 'activations' table
export interface Activation {
    id: number; // BIGSERIAL
    user_id: number; // BIGINT (FK to users.id)
    script_id: number; // BIGINT (FK to scripts.id)
    context?: string | null;
    activated_at: string; // TIMESTAMPTZ
}

// Corresponds to the 'compute_jobs' table
export type ComputeJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export interface ComputeJob {
    id: number; // BIGSERIAL
    script_id: number; // BIGINT (FK to scripts.id)
    context?: string | null;
    status: ComputeJobStatus;
    result?: string | null;
    created_at: string; // TIMESTAMPTZ
    updated_at: string; // TIMESTAMPTZ
}

// Corresponds to the 'notifications' table
export type NotificationType = 'script_ready' | 'compute_done' | 'error';
export interface Notification {
    id: number; // BIGSERIAL
    user_id: number; // BIGINT (FK to users.id)
    script_id?: number | null; // BIGINT (FK to scripts.id)
    compute_job_id?: number | null; // BIGINT (FK to compute_jobs.id)
    type: NotificationType;
    message: string;
    is_read: boolean;
    created_at: string; // TIMESTAMPTZ
} 