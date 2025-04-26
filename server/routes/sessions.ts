import { Router, Context } from "oak";
import { supabase } from "../db/supabaseClient.ts";
import { Session } from "../db/models.ts";

const router = new Router();

// GET /api/sessions - List sessions (consider filtering by user_id)
router.get("/", async (ctx: Context) => {
    // TODO: Implement filtering, pagination, and security (e.g., user can only see their sessions)
    const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .order('started_at', { ascending: false }); // Example ordering

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to fetch sessions", message: error.message };
        return;
    }
    ctx.response.body = data;
});

// GET /api/sessions/:id - Get a specific session
router.get("/:id", async (ctx: Context) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Session ID is required" };
        return;
    }

    // TODO: Add security check - does the current user own this session?
    const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', id)
        .single();

    if (error || !data) {
        ctx.response.status = error?.code === 'PGRST116' ? 404 : 500;
        ctx.response.body = { error: error?.code === 'PGRST116' ? "Session not found" : "Failed to fetch session", message: error?.message };
        return;
    }

    ctx.response.body = data;
});

// POST /api/sessions - Start a new session
router.post("/", async (ctx: Context) => {
    try {
        const body = await ctx.request.body.json();
        const { user_id, context } = body as Partial<Session>;

        // Basic validation
        if (!user_id) {
            ctx.response.status = 400;
            ctx.response.body = { error: "user_id is required to start a session" };
            return;
        }

        // TODO: Validate user_id exists in the users table

        const { data, error } = await supabase
            .from('sessions')
            .insert([{ user_id, context }])
            .select()
            .single();

        if (error) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Failed to create session", message: error.message };
            return;
        }

        ctx.response.status = 201;
        ctx.response.body = data;
    } catch (err) {
        console.error("Error creating session:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during session creation" };
    }
});

// PUT /api/sessions/:id - End a session (update ended_at)
router.put("/:id/end", async (ctx: Context) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Session ID is required" };
        return;
    }

    // TODO: Add security check - does the current user own this session?

    const { data, error } = await supabase
        .from('sessions')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

    if (error || !data) {
        ctx.response.status = error?.code === 'PGRST116' ? 404 : 500;
        ctx.response.body = { error: error?.code === 'PGRST116' ? "Session not found to end" : "Failed to end session", message: error?.message };
        return;
    }

    ctx.response.body = data;
});

// Add DELETE route if necessary, considering cascading deletes.

export default router; 