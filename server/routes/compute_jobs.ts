import { Router, Context } from "oak";
import { supabase } from "../db/supabaseClient.ts";
import { ComputeJob, ComputeJobStatus } from "../db/models.ts";

const router = new Router();

// GET /api/compute_jobs - List jobs (potentially filtered)
router.get("/", async (ctx: Context) => {
    // TODO: Add filtering (by script_id, status) and security (admin only?)
    const { data, error } = await supabase
        .from('compute_jobs')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to fetch compute jobs", message: error.message };
        return;
    }
    ctx.response.body = data;
});

// GET /api/compute_jobs/:id - Get status of a specific job
router.get("/:id", async (ctx: Context) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Compute Job ID is required" };
        return;
    }

    // TODO: Security check: Does user own the script related to this job? Or admin?
    const { data, error } = await supabase
        .from('compute_jobs')
        .select(`
            id, status, result, context, created_at, updated_at,
            script:scripts(id, session_id)
        `)
        .eq('id', id)
        .single();

    if (error || !data) {
        ctx.response.status = error?.code === 'PGRST116' ? 404 : 500;
        ctx.response.body = { error: error?.code === 'PGRST116' ? "Compute job not found" : "Failed to fetch compute job", message: error?.message };
        return;
    }

    ctx.response.body = data;
});

// PUT /api/compute_jobs/:id - Update job status and result (called by compute service)
router.put("/:id", async (ctx: Context) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Compute Job ID is required" };
        return;
    }

    try {
        // TODO: Secure this endpoint - should only be callable by the trusted compute service
        const body = await ctx.request.body.json();
        const { status, result } = body as Partial<ComputeJob>;

        // Validation
        if (!status) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Status field is required for update" };
            return;
        }
        if (!['queued', 'running', 'completed', 'failed'].includes(status)) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Invalid status provided" };
            return;
        }

        const updateData: Partial<ComputeJob> & { updated_at: string } = {
            status,
            updated_at: new Date().toISOString(),
        };
        if (result !== undefined) {
            updateData.result = result;
        }

        const { data: updatedJob, error } = await supabase
            .from('compute_jobs')
            .update(updateData)
            .eq('id', id)
            .select('id, script_id, status') // Select fields needed for notification
            .single();

        if (error || !updatedJob) {
            ctx.response.status = error?.code === 'PGRST116' ? 404 : 500;
            ctx.response.body = { error: error?.code === 'PGRST116' ? "Compute job not found to update" : "Failed to update compute job", message: error?.message };
            return;
        }

        // --- Trigger Notification on Completion/Failure --- 
        if (status === 'completed' || status === 'failed') {
            // 1. Find the user associated with the script
            const { data: scriptData, error: scriptError } = await supabase
                .from('scripts')
                .select('session:sessions(user_id)')
                .eq('id', updatedJob.script_id)
                .single();

            if (scriptError || !scriptData?.session?.user_id) {
                console.error(`Failed to find user for script ${updatedJob.script_id} to send notification for job ${id}:`, scriptError);
            } else {
                const userId = scriptData.session.user_id;
                const notificationType = status === 'completed' ? 'compute_done' : 'error';
                const message = status === 'completed'
                    ? `Your script execution has completed.`
                    : `Your script execution failed.`;

                // 2. Create notification
                const { error: notificationError } = await supabase
                    .from('notifications')
                    .insert([{
                        user_id: userId,
                        compute_job_id: id,
                        script_id: updatedJob.script_id,
                        type: notificationType,
                        message: message
                    }]);

                if (notificationError) {
                    console.error(`Failed to create notification for job ${id} completion/failure:`, notificationError);
                    // Don't fail the job update request, just log the error
                }
            }
        }

        ctx.response.body = updatedJob;

    } catch (err) {
        console.error(`Error updating compute job ${id}:`, err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during compute job update" };
    }
});


export default router; 