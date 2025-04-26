import { Router, Context } from "oak";
import { supabase } from "../db/supabaseClient.ts";
import { Notification } from "../db/models.ts";

const router = new Router();

// GET /api/notifications?user_id=<uuid>&unread_only=true - List notifications for a user
router.get("/", async (ctx: Context) => {
    const userId = ctx.request.url.searchParams.get('user_id');
    const unreadOnly = ctx.request.url.searchParams.get('unread_only') === 'true';
    // TODO: Get user_id from authenticated session/token instead of query param

    if (!userId) {
        ctx.response.status = 400;
        ctx.response.body = { error: "user_id query parameter is required (or derived from auth)" };
        return;
    }

    let query = supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId);

    if (unreadOnly) {
        query = query.eq('is_read', false);
    }

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to fetch notifications", message: error.message };
        return;
    }
    ctx.response.body = data;
});

// PUT /api/notifications/:id/read - Mark a notification as read
router.put("/:id/read", async (ctx: Context) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Notification ID is required" };
        return;
    }

    // TODO: Security check: Does user own this notification?
    const { data, error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id)
        // Optional: Add .eq('user_id', authenticatedUserId) for security
        .select()
        .single();

    if (error || !data) {
        ctx.response.status = error?.code === 'PGRST116' ? 404 : 500;
        ctx.response.body = { error: error?.code === 'PGRST116' ? "Notification not found to mark as read" : "Failed to update notification", message: error?.message };
        return;
    }

    ctx.response.body = { success: true, notification: data };
});

// POST /api/notifications/read-all - Mark all user notifications as read
router.post("/read-all", async (ctx: Context) => {
    // TODO: Get user_id from authenticated session/token
    const body = await ctx.request.body.json();
    const userId = body?.user_id;

    if (!userId) {
        ctx.response.status = 400;
        ctx.response.body = { error: "user_id is required in request body (or derived from auth)" };
        return;
    }

    const { error, count } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false); // Only update unread ones

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to mark all notifications as read", message: error.message };
        return;
    }

    ctx.response.body = { success: true, updated_count: count ?? 0 };
});

export default router; 