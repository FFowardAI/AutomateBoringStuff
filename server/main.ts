import { Application, Router, Context, Next } from "oak";
import { oakCors } from "cors";
import { config } from "dotenv";
import { parse } from "std/flags/mod.ts";

// Ensure Supabase client is initialized early
import { supabase } from "./db/supabaseClient.ts";

// Load environment variables
const env = await config({ safe: true, export: true });

// Import new routes
import usersRoutes from "./routes/users.ts";
import recordingsRoutes from "./routes/recordings.ts";
import imagesRoutes from "./routes/images.ts";
import scriptsRoutes from "./routes/scripts.ts";
import activationsRoutes from "./routes/activations.ts";
import computeJobsRoutes from "./routes/compute_jobs.ts";
import notificationsRoutes from "./routes/notifications.ts";
// Placeholder routes for external integrations
import vlmRoutes from "./routes/vlm.ts";
import computerUseRoutes from "./routes/computer_use.ts";

// Parse command line arguments
const args = parse(Deno.args);
const port = parseInt(args.port as string || env.PORT || "8002");

// Initialize the application
const app = new Application();
const router = new Router();

// Middleware
app.use(oakCors({
    origin: "*", // Allow any origin (less secure, okay for dev)
    // origin: "chrome-extension://goleppcndgbgndgmbecpllecmdcldbad", // Specify your extension ID
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // Ensure OPTIONS is included for preflight
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Accept", // Good practice to allow Accept header
        "ngrok-skip-browser-warning" // Add the ngrok header
    ],
    credentials: true,
    // Optional: configure preflight max age
    // preflightMaxAge: 86400,
}));

// Error handling middleware
app.use(async (ctx: Context, next: Next) => {
    try {
        await next();
    } catch (err: unknown) {
        const error = err as Error & { status?: number; expose?: boolean };
        console.error(`Error during request ${ctx.request.method} ${ctx.request.url}: `, error);

        ctx.response.status = error.status || 500;
        ctx.response.body = {
            error: error.expose ? error.message : "Internal Server Error",
            ...(Deno.env.get("ENV") === "development" && { stack: error.stack }), // Show stack in dev
        };
    }
});

// Request logging middleware
app.use(async (ctx: Context, next: Next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.log(`${ctx.request.method} ${ctx.request.url.pathname}${ctx.request.url.search} - ${ctx.response.status} - ${ms} ms`);
});

// Basic Routes
router
    .get("/", (ctx: Context) => {
        ctx.response.body = {
            name: "AutomateBoringStuff Supabase API",
            version: "1.0.0",
            status: "running",
        };
    })
    .get("/health", (ctx: Context) => {
        // TODO: Add database connectivity check?
        ctx.response.body = { status: "healthy" };
    });

// Register API routes
router.use("/api/users", usersRoutes.routes(), usersRoutes.allowedMethods());
router.use("/api/recordings", recordingsRoutes.routes(), recordingsRoutes.allowedMethods());
router.use("/api/images", imagesRoutes.routes(), imagesRoutes.allowedMethods());
router.use("/api/scripts", scriptsRoutes.routes(), scriptsRoutes.allowedMethods());
router.use("/api/activations", activationsRoutes.routes(), activationsRoutes.allowedMethods());
router.use("/api/compute_jobs", computeJobsRoutes.routes(), computeJobsRoutes.allowedMethods());
router.use("/api/notifications", notificationsRoutes.routes(), notificationsRoutes.allowedMethods());
// Placeholder routes
router.use("/api/vlm", vlmRoutes.routes(), vlmRoutes.allowedMethods());
router.use("/api/computer-use", computerUseRoutes.routes(), computerUseRoutes.allowedMethods());

// Add router middleware
app.use(router.routes());
app.use(router.allowedMethods());

// Start the server
app.addEventListener("listen", ({ hostname, port, secure }: { hostname: string; port: number; secure: boolean }) => {
    console.log(
        `🚀 Server listening on ${secure ? "https" : "http"}://${hostname || "localhost"}:${port}`
    );
    console.log(`🔑 Supabase URL: ${env.SUPABASE_URL?.substring(0, 20)}...`); // Log partial URL
});

await app.listen({ port });