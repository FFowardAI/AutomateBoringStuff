import { Router, Context, State } from "oak";
import { supabase } from "../db/supabaseClient.ts";
import { User } from "../db/models.ts";
import { privateEncrypt } from "node:crypto";

const router = new Router();

// GET /api/users - List all users (potentially limited or secured)
router.get("/", async (ctx: Context) => {
    const { data, error } = await supabase
        .from('users')
        .select('*');

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to fetch users", message: error.message };
        return;
    }
    ctx.response.body = data;
});

// GET /api/users/:id - Get a specific user by ID
router.get("/:id", async (ctx: Context) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "User ID is required" };
        return;
    }

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .single(); // Use .single() if expecting one or zero results

    if (error) {
        ctx.response.status = 500;
        if (error.code === 'PGRST116') { // Error code for no rows found
            ctx.response.status = 404;
            ctx.response.body = { error: "User not found" };
        } else {
            ctx.response.body = { error: "Failed to fetch user", message: error.message };
        }
        return;
    }

    if (!data) {
        ctx.response.status = 404;
        ctx.response.body = { error: "User not found" };
        return;
    }

    ctx.response.body = data;
});

// POST /api/users - Create a new user (example)
// In practice, user creation might happen via Supabase Auth or implicitly
router.post("/", async (ctx: Context) => {
    try {
        const body = await ctx.request.body.json();
        console.log(body);
        const { name, email } = body as Partial<User>;

        // Basic validation
        if (!email) { // Assuming email is the minimum required field
            ctx.response.status = 400;
            ctx.response.body = { error: "Email is required to create a user" };
            return;
        }

        const { data, error } = await supabase
            .from('users')
            .insert([{ name, email }])
            .select()
            .single();

        if (error) {
            // Handle potential unique constraint violation for email
            if (error.code === '23505') { // Unique violation code
                ctx.response.status = 409; // Conflict
                ctx.response.body = { error: "User with this email already exists", message: error.message };
            } else {
                ctx.response.status = 500;
                ctx.response.body = { error: "Failed to create user", message: error.message };
            }
            return;
        }

        ctx.response.status = 201;
        ctx.response.body = data;
    } catch (err) {
        console.error("Error creating user:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during user creation" };
    }
});

// Add PUT (update) and DELETE routes as needed, respecting security principles.

export default router; 