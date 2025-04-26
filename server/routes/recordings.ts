import { Router, Context } from "oak";
import { supabase } from "../db/supabaseClient.ts";
import { Recording } from "../db/models.ts";

const router = new Router();

// GET /api/recordings?session_id=<uuid> - List recordings for a session
router.get("/", async (ctx: Context) => {
    const sessionId = ctx.request.url.searchParams.get('session_id');

    if (!sessionId) {
        ctx.response.status = 400;
        ctx.response.body = { error: "session_id query parameter is required" };
        return;
    }

    // TODO: Add security check - does the current user own the parent session?

    const { data, error } = await supabase
        .from('recordings')
        .select('*')
        .eq('session_id', sessionId)
        .order('start_time', { ascending: true });

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to fetch recordings", message: error.message };
        return;
    }
    ctx.response.body = data;
});

// GET /api/recordings/:id - Get a specific recording
router.get("/:id", async (ctx: Context) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Recording ID is required" };
        return;
    }

    // TODO: Add security check
    const { data, error } = await supabase
        .from('recordings')
        .select('*')
        .eq('id', id)
        .single();

    if (error || !data) {
        ctx.response.status = error?.code === 'PGRST116' ? 404 : 500;
        ctx.response.body = { error: error?.code === 'PGRST116' ? "Recording not found" : "Failed to fetch recording", message: error?.message };
        return;
    }

    ctx.response.body = data;
});

// POST /api/recordings - Create a new recording period within a session
router.post("/", async (ctx: Context) => {
    try {
        const body = await ctx.request.body.json();
        const { session_id, start_time, end_time } = body as Partial<Recording>;

        // Basic validation
        if (!session_id || !start_time || !end_time) {
            ctx.response.status = 400;
            ctx.response.body = { error: "session_id, start_time, and end_time are required" };
            return;
        }

        // TODO: Validate session_id exists and belongs to user
        // TODO: Validate time format/values

        const { data, error } = await supabase
            .from('recordings')
            .insert([{ session_id, start_time, end_time }])
            .select()
            .single();

        if (error) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Failed to create recording", message: error.message };
            return;
        }

        ctx.response.status = 201;
        ctx.response.body = data;
    } catch (err) {
        console.error("Error creating recording:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during recording creation" };
    }
});

// Add PUT/DELETE if modification/deletion of recording periods is needed.

export default router; 