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
        [key: string]: string; // IDs are now numbers but come as strings from params
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

// GET /api/scripts - List scripts (e.g., filtered by user)
router.get("/", async (ctx: Context) => {
    const userIdStr = ctx.request.url.searchParams.get('user_id');

    let query = supabase.from('scripts').select(`
        *,
        recording:recordings!inner(user_id)
    `).order('created_at', { ascending: false });


    if (userIdStr) {
        const userId = parseInt(userIdStr);
        if (isNaN(userId)) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Invalid user_id format" };
            return;
        }
        // Filter by user_id through the recordings table
        query = query.eq('recording.user_id', userId);
    }

    const { data, error } = await query;

    if (error) {
        console.error("Error fetching scripts:", error);
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to fetch scripts", message: error.message };
        return;
    }

    // Clean up the response structure if needed (remove recording details if not desired)
    const cleanedData = data?.map(script => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { recording, ...rest } = script;
        return rest;
    }) || [];


    ctx.response.body = cleanedData;
});

// GET /api/scripts/all?user_id= - List all scripts
router.get("/all", async (ctx: Context) => {
    const userIdStr = ctx.request.url.searchParams.get('user_id');
    if (!userIdStr) {
        ctx.response.status = 400;
        ctx.response.body = { error: "user_id parameter is required" };
        return;
    }

    const userId = parseInt(userIdStr);
    if (isNaN(userId)) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Invalid user_id format" };
        return;
    }

    const { data, error } = await supabase.from('scripts').select('*').eq('recording.user_id', userId).order('created_at', { ascending: false });

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to fetch scripts", message: error.message };
        return;
    }
    console.log("Fetched scripts:", data);
    ctx.response.body = data;
});

// GET /api/scripts/:id - Get a specific script by numeric ID
router.get("/:id", async (ctx: RouterContext) => {
    const idStr = ctx.params.id;
    const id = parseInt(idStr);

    if (isNaN(id)) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Invalid Script ID format" };
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
        // Expect recording_id instead of session_id
        const { recording_id, content, status = 'pending', is_structured = false, structured_data = null } = body as Partial<Script>;

        // Basic validation
        if (recording_id === undefined || recording_id === null) {
            ctx.response.status = 400;
            ctx.response.body = { error: "recording_id is required" };
            return;
        }
        if (typeof recording_id !== 'number') {
            ctx.response.status = 400;
            ctx.response.body = { error: "recording_id must be a number" };
            return;
        }
        if (!content) {
            ctx.response.status = 400;
            ctx.response.body = { error: "content is required" };
            return;
        }
        if (!['pending', 'completed', 'failed'].includes(status)) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Invalid status provided" };
            return;
        }

        // TODO: Validate recording_id exists and belongs to user

        const { data, error } = await supabase
            .from('scripts')
            .insert([{ recording_id, content, status, is_structured, structured_data }])
            .select()
            .single();

        if (error) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Failed to create script record", message: error.message };
            return;
        }

        // TODO: Potentially trigger a notification for the user ('script_ready')

        ctx.response.status = 201;
        ctx.response.body = data;
    } catch (err) {
        console.error("Error creating script record:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during script creation" };
    }
});

// PUT /api/scripts/:id - Update a script (status, content, etc.) by numeric ID
router.put("/:id", async (ctx: RouterContext) => {
    const idStr = ctx.params.id;
    const id = parseInt(idStr);

    if (isNaN(id)) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Invalid Script ID format" };
        return;
    }

    try {
        // TODO: Security check
        const body = await ctx.request.body.json();
        // Note: recording_id is usually not updatable after creation
        const { status, content, is_structured, structured_data } = body as Partial<Omit<Script, 'recording_id'>>;

        // Simple validation
        const validStatuses = ['pending', 'completed', 'failed'];
        if (status && !validStatuses.includes(status)) {
            ctx.response.status = 400;
            ctx.response.body = { error: `Invalid status provided. Must be one of: ${validStatuses.join(', ')}` };
            return;
        }

        // Prepare update data
        const updateData: Partial<Omit<Script, 'id' | 'recording_id' | 'created_at'>> = {};
        if (status) updateData.status = status as ScriptStatus;
        if (content !== undefined) updateData.content = content;
        if (is_structured !== undefined) updateData.is_structured = is_structured;
        if (structured_data !== undefined) updateData.structured_data = structured_data;

        if (Object.keys(updateData).length === 0) {
            ctx.response.status = 400;
            ctx.response.body = { error: "No valid fields provided for update" };
            return;
        }

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

// DELETE /api/scripts/:id - Delete a script by numeric ID
router.delete("/:id", async (ctx: RouterContext) => {
    const idStr = ctx.params.id;
    const id = parseInt(idStr);

    if (isNaN(id)) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Invalid Script ID format" };
        return;
    }

    // TODO: Add security check - does user own this script or have delete permission?
    // Consider implications: deleting script might orphan compute_jobs? (FK is ON DELETE CASCADE)
    const { error } = await supabase
        .from('scripts')
        .delete()
        .eq('id', id);

    if (error) {
        // Check if it failed because it wasn't found
        if (error.code === 'PGRST116' || (error.details?.includes("Results contain 0 rows"))) {
            ctx.response.status = 404;
            ctx.response.body = { error: "Script not found to delete" };
        } else {
            ctx.response.status = 500;
            ctx.response.body = { error: "Failed to delete script", message: error.message };
        }
        return;
    }

    ctx.response.status = 204; // No content
});

// POST /api/scripts/:id/update-with-context - Update script using context by numeric ID
router.post("/:id/update-with-context", async (ctx: RouterContext) => {
    const idStr = ctx.params.id;
    const id = parseInt(idStr);

    if (isNaN(id)) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Invalid Script ID format" };
        return;
    }

    console.log("Updating script with context:", id);
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
            .select('*') // Select all fields including content
            .eq('id', id)
            .single();

        console.log("Fetched script:", script, "Error:", scriptError);

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
        console.log("Using Anthropic API Key:", apiKey ? "Found" : "Not Found");
        if (!apiKey) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Anthropic API key not found in server configuration" };
            return;
        }
        console.log("Updating script content with context:", script.content, context);

        // Update the script with the new context using the utility function
        const { scriptContent, isValidJson, structuredContent } = await updateScriptWithContext(
            apiKey,
            script.content, // Pass the existing script content
            context
        );
        console.log("Received updated script content:", scriptContent);

        // Prepare data for database update
        const updateData: Partial<Script> = {
            content: scriptContent,
            is_structured: isValidJson,
            structured_data: isValidJson ? structuredContent : null
        };

        // Update the script in the database
        const { data: updatedScript, error: updateError } = await supabase
            .from('scripts')
            .update(updateData)
            .eq('id', id)
            .select() // Select the updated row
            .single();

        if (updateError) {
            console.error("Error updating script in DB:", updateError);
            ctx.response.status = 500;
            ctx.response.body = { error: "Failed to update script in database", message: updateError.message };
            return;
        }

        console.log("Successfully updated script in DB:", updatedScript);
        // Return only the updated content as per previous behavior (or return updatedScript object)
        ctx.response.body = updatedScript.content;
        // Or return the full updated script:
        // ctx.response.body = updatedScript;

    } catch (err: unknown) {
        console.error(`Error updating script ${id} with context:`, err);
        ctx.response.status = 500;
        ctx.response.body = {
            error: "Internal server error during script update with context",
            message: err instanceof Error ? err.message : String(err)
        };
    }
});


export default router; 