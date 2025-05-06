import { Router, Context, State } from "oak";
import { supabase } from "../db/supabaseClient.ts";
import { User } from "../db/models.ts";

const router = new Router();

// Define a helper type for Router Context that includes params
type RouterContext = Context & {
    params: {
        [key: string]: string; // IDs are now numbers but come as strings from params
    };
};

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

router.get("/by-email/:email", async (ctx: RouterContext) => {
    const { email } = ctx.params;
    if (!email) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Email parameter is required" };
        return;
    }

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', decodeURIComponent(email))
        .single();

    console.log("Fetched user by email:", email, "Result:", data);

    if (error) {
        if (error.code === 'PGRST116') {
            ctx.response.status = 404;
            ctx.response.body = { error: "User not found" };
        } else {
            console.error("Error fetching user by email:", error);
            ctx.response.status = 500;
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

// GET /api/users/:id - Get a specific user by numeric ID
router.get("/:id", async (ctx: RouterContext) => {
    const idStr = ctx.params.id;
    const id = parseInt(idStr);

    if (isNaN(id)) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Invalid User ID format" };
        return;
    }

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            ctx.response.status = 404;
            ctx.response.body = { error: "User not found" };
        } else {
            console.error("Error fetching user by ID:", error);
            ctx.response.status = 500;
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

// POST /api/users - Create a new user
router.post("/", async (ctx: Context) => {
    try {
        const body = await ctx.request.body.json();
        console.log("Request body for user creation:", body);
        const {
            name,
            email,
            permissions,
            role_id,
            organization_id
        } = body as Partial<User>;

        if (!name) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Name is required to create a user" };
            return;
        }
        if (!email) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Email is required to create a user" };
            return;
        }

        const insertData: Partial<User> = { name, email };
        if (permissions !== undefined) insertData.permissions = permissions;
        if (role_id !== undefined) insertData.role_id = role_id;
        if (organization_id !== undefined) insertData.organization_id = organization_id;

        const { data, error } = await supabase
            .from('users')
            .insert([insertData])
            .select()
            .single();

        if (error) {
            if (error.code === '23505' && error.message.includes('users_email_key')) {
                ctx.response.status = 409;
                ctx.response.body = { error: "User with this email already exists", message: error.message };
            } else {
                console.error("Error inserting user:", error);
                ctx.response.status = 500;
                ctx.response.body = { error: "Failed to create user", message: error.message };
            }
            return;
        }

        console.log("Successfully created user:", data);
        ctx.response.status = 201;
        ctx.response.body = data;
    } catch (err: any) {
        console.error("Error creating user:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during user creation", message: err.message };
    }
});

// Add PUT (update) and DELETE routes as needed, respecting security principles.

export default router; 