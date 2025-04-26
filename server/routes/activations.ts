import { Router, Context } from "oak";
import { supabase } from "../db/supabaseClient.ts";
import { Activation } from "../db/models.ts";

const router = new Router();

// GET /api/activations?user_id=<uuid> - List activations for a user
router.get("/", async (ctx: Context) => {
    const userId = ctx.request.url.searchParams.get('user_id');
    // TODO: Get user_id from authenticated session/token instead of query param

    if (!userId) {
        ctx.response.status = 400;
        ctx.response.body = { error: "user_id query parameter is required (or derived from auth)" };
        return;
    }

    const { data, error } = await supabase
        .from('activations')
        .select(`
            id, context, activated_at,
            script:scripts(id, session_id, status) 
        `)
        .eq('user_id', userId)
        .order('activated_at', { ascending: false });

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to fetch activations", message: error.message };
        return;
    }
    ctx.response.body = data;
});

// GET /api/activations/:id - Get a specific activation
router.get("/:id", async (ctx: Context) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Activation ID is required" };
        return;
    }

    // TODO: Add security check (user owns this activation)
    const { data, error } = await supabase
        .from('activations')
        .select(`*, script:scripts(*)`)
        .eq('id', id)
        .single();

    if (error || !data) {
        ctx.response.status = error?.code === 'PGRST116' ? 404 : 500;
        ctx.response.body = { error: error?.code === 'PGRST116' ? "Activation not found" : "Failed to fetch activation", message: error?.message };
        return;
    }

    ctx.response.body = data;
});

// POST /api/activations - Trigger a script activation
router.post("/", async (ctx: Context) => {
    try {
        const body = await ctx.request.body.json();
        const { user_id, script_id, context } = body as Partial<Activation>;

        // Basic validation
        if (!user_id || !script_id) {
            ctx.response.status = 400;
            ctx.response.body = { error: "user_id and script_id are required" };
            return;
        }
        // TODO: Validate user_id from auth token
        // TODO: Validate script_id exists and is in a 'completed' state?

        // 1. Create the activation record
        const { data: activationData, error: activationError } = await supabase
            .from('activations')
            .insert([{ user_id, script_id, context }])
            .select()
            .single();

        if (activationError) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Failed to create activation record", message: activationError.message };
            return;
        }

        // --- Trigger Compute Job --- 
        // 2. Create a corresponding compute_job record
        const { data: jobData, error: jobError } = await supabase
            .from('compute_jobs')
            .insert([{
                script_id: script_id,
                context: context, // Pass activation context to the job
                status: 'queued' // Start as queued
            }])
            .select('id') // Only need the ID for response
            .single();

        if (jobError) {
            // Attempt to clean up the activation record if job creation fails?
            // Or mark activation as failed?
            console.error(`Failed to create compute_job for activation ${activationData.id}:`, jobError);
            ctx.response.status = 500;
            ctx.response.body = {
                error: "Activation created, but failed to queue compute job",
                message: jobError.message,
                activation: activationData // Return activation data anyway
            };
            return;
        }

        // 3. (Placeholder) Notify the actual compute service/worker to pick up this job_id
        console.log(`Placeholder: Notify compute service to start job ${jobData.id} for script ${script_id}`);
        // This could involve adding the job ID to a message queue (e.g., RabbitMQ, SQS) 
        // or calling an API endpoint on the compute service.

        ctx.response.status = 201;
        ctx.response.body = {
            activation: activationData,
            compute_job_id: jobData.id
        };

    } catch (err) {
        console.error("Error creating activation:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during activation" };
    }
});

export default router; 