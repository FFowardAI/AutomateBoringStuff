import { Router, Context } from "oak";
import { supabase } from "../db/supabaseClient.ts";
import { Script, ScriptStatus } from "../db/models.ts";
import { updateScriptWithContext } from "../utils/anthropicUtils.ts";
import { config } from "dotenv";

// Load environment variables
const env = await config({ safe: true, export: true });

const router = new Router();

// Define a helper type for Router Context that includes params
type RouterContext = Context & {
    params: {
        [key: string]: string;
    };
};

// GET /api/scripts/all - List all scripts
router.get("/all", async (ctx: Context) => {
    const { data, error } = await supabase
        .from('scripts')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to fetch scripts", message: error.message };
        return;
    }
    ctx.response.body = data;
});

// GET /api/scripts - List scripts (potentially filtered)
router.get("/", async (ctx: Context) => {
    // TODO: Add filtering (e.g., by user_id, status, etc.)
    const { data, error } = await supabase
        .from('scripts')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to fetch scripts", message: error.message };
        return;
    }
    ctx.response.body = data;
});

// GET /api/scripts/:id - Get a specific script
router.get("/:id", async (ctx: RouterContext) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Script ID is required" };
        return;
    }

    // TODO: Add security check - does user own this script or have access?
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
        const { session_id, content, status = 'pending', is_structured = false, structured_data = null } = body as Partial<Script>;

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
            .insert([{ session_id, content, status, is_structured, structured_data }])
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

// PUT /api/scripts/:id - Update a script (status, etc.)
router.put("/:id", async (ctx: RouterContext) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Script ID is required" };
        return;
    }

    try {
        const body = await ctx.request.body.json();
        const { status, content, is_structured, structured_data } = body as Partial<Script>;

        // Simple validation
        const validStatuses = ['pending', 'completed', 'failed'];
        if (status && !validStatuses.includes(status)) {
            ctx.response.status = 400;
            ctx.response.body = { error: `Invalid status provided. Must be one of: ${validStatuses.join(', ')}` };
            return;
        }

        // Prepare update data
        const updateData: Partial<Script> = {};
        if (status) updateData.status = status as ScriptStatus;
        if (content !== undefined) updateData.content = content;
        if (is_structured !== undefined) updateData.is_structured = is_structured;
        if (structured_data !== undefined) updateData.structured_data = structured_data;

        // Perform the update
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

        ctx.response.body = data;

    } catch (err) {
        console.error(`Error updating script ${id}:`, err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during script update" };
    }
});

// DELETE /api/scripts/:id - Delete a script
router.delete("/:id", async (ctx: RouterContext) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Script ID is required" };
        return;
    }

    // TODO: Add security check - does user own this script or have delete permission?
    const { error } = await supabase
        .from('scripts')
        .delete()
        .eq('id', id);

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to delete script", message: error.message };
        return;
    }

    ctx.response.status = 204; // No content
});

// POST /api/scripts/:id/update-with-context - Update a script with additional context
router.post("/:id/update-with-context", async (ctx: RouterContext) => {
    const { id } = ctx.params;
    console.log("Updating script with context:", id);
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Script ID is required" };
        return;
    }

    try {
        // Parse the request body
        const body = await ctx.request.body.json();
        console.log("Body:", body);
        const { context } = body;

        if (!context) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Context is required" };
            return;
        }
        console.log("Context:", context);

        // Get the existing script
        const { data: script, error: scriptError } = await supabase
            .from('scripts')
            .select('*')
            .eq('id', id)
            .single();

        console.log(scriptError, script);

        if (scriptError || !script) {
            ctx.response.status = scriptError?.code === 'PGRST116' ? 404 : 500;
            ctx.response.body = {
                error: scriptError?.code === 'PGRST116' ? "Script not found" : "Failed to fetch script",
                message: scriptError?.message
            };
            return;
        }

        // Get API key from environment
        const apiKey = env.ANTHROPIC_API_KEY;
        console.log("API Key:", apiKey);
        if (!apiKey) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Anthropic API key not found in server configuration" };
            return;
        }
        console.log("Updating script with context:", script.content, context);
        // Update the script with the new context
        const { scriptContent, isValidJson, structuredContent } = await updateScriptWithContext(
            apiKey,
            script.content,
            context
        );
        console.log("Script content:", scriptContent);
        // Update the script in the database
        const updateData: Partial<Script> = {
            content: scriptContent,
            is_structured: isValidJson,
            structured_data: isValidJson ? structuredContent : null
        };

        // const { data: updatedScript, error: updateError } = await supabase
        //     .from('scripts')
        //     .update(updateData)
        //     .eq('id', id)
        //     .select()
        //     .single();

        // if (updateError) {
        //     ctx.response.status = 500;
        //     ctx.response.body = { error: "Failed to update script", message: updateError.message };
        //     return;
        // }

        ctx.response.body = updateData.content;
    } catch (err: unknown) {
        console.error(`Error updating script ${id} with context:`, err);
        ctx.response.status = 500;
        ctx.response.body = {
            error: "Internal server error during script update",
            message: err instanceof Error ? err.message : String(err)
        };
    }
});

export default router; 