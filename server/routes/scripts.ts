import { Router, Context } from "oak";
import { supabase } from "../db/supabaseClient.ts";
import { Script, ScriptStatus } from "../db/models.ts";

const router = new Router();

// GET /api/scripts?session_id=<uuid> - List scripts for a session
router.get("/", async (ctx: Context) => {
    const sessionId = ctx.request.url.searchParams.get('session_id');

    if (!sessionId) {
        ctx.response.status = 400;
        ctx.response.body = { error: "session_id query parameter is required" };
        return;
    }

    // TODO: Security check: Does user own the parent session?
    const { data, error } = await supabase
        .from('scripts')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false });

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to fetch scripts", message: error.message };
        return;
    }
    ctx.response.body = data;
});

// GET /api/scripts/:id - Get a specific script
router.get("/:id", async (ctx: Context) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Script ID is required" };
        return;
    }

    // TODO: Add security check
    const { data, error } = await supabase
        .from('scripts')
        .select('*')
        .eq('id', id)
        .single();

    if (error || !data) {
        ctx.response.status = error?.code === 'PGRST116' ? 404 : 500;
        ctx.response.body = { error: error?.code === 'PGRST116' ? "Script not found" : "Failed to fetch script", message: error?.message };
        return;
    }

    ctx.response.body = data;
});

// POST /api/scripts - Create a new script record (likely triggered by VLM completion)
router.post("/", async (ctx: Context) => {
    try {
        const body = await ctx.request.body.json();
        const { session_id, content, status = 'pending' } = body as Partial<Script>;

        // Basic validation
        if (!session_id || !content) {
            ctx.response.status = 400;
            ctx.response.body = { error: "session_id and content are required" };
            return;
        }
        if (!['pending', 'completed', 'failed'].includes(status)) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Invalid status provided" };
            return;
        }

        // TODO: Validate session_id exists and belongs to user

        const { data, error } = await supabase
            .from('scripts')
            .insert([{ session_id, content, status }])
            .select()
            .single();

        if (error) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Failed to create script record", message: error.message };
            return;
        }

        // TODO: Potentially trigger a notification for the user

        ctx.response.status = 201;
        ctx.response.body = data;
    } catch (err) {
        console.error("Error creating script record:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during script creation" };
    }
});

// PUT /api/scripts/:id - Update script content or status
router.put("/:id", async (ctx: Context) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Script ID is required" };
        return;
    }

    try {
        const body = await ctx.request.body.json();
        const { content, status } = body as Partial<Script>;

        const updateData: Partial<Script> = {};
        if (content !== undefined) updateData.content = content;
        if (status !== undefined) {
            if (!['pending', 'completed', 'failed'].includes(status)) {
                ctx.response.status = 400;
                ctx.response.body = { error: "Invalid status provided" };
                return;
            }
            updateData.status = status;
        }

        if (Object.keys(updateData).length === 0) {
            ctx.response.status = 400;
            ctx.response.body = { error: "No update fields provided (content, status)" };
            return;
        }

        // TODO: Security check
        const { data, error } = await supabase
            .from('scripts')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error || !data) {
            ctx.response.status = error?.code === 'PGRST116' ? 404 : 500;
            ctx.response.body = { error: error?.code === 'PGRST116' ? "Script not found to update" : "Failed to update script", message: error?.message };
            return;
        }

        // TODO: Trigger notification if status changed (e.g., to 'completed')

        ctx.response.body = data;
    } catch (err) {
        console.error(`Error updating script ${id}:`, err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during script update" };
    }
});

// DELETE /api/scripts/:id - Delete a script
router.delete("/:id", async (ctx: Context) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Script ID is required" };
        return;
    }

    // TODO: Add security check
    // Note: Cascading deletes should handle related activations, compute_jobs, notifications if set up correctly in DB schema

    const { error } = await supabase
        .from('scripts')
        .delete()
        .eq('id', id);

    if (error) {
        // Check if the error is because the script was not found
        // Supabase delete doesn't error on not found, but count might be 0 if needed
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to delete script", message: error.message };
        return;
    }

    ctx.response.status = 204; // No Content
});

export default router; 