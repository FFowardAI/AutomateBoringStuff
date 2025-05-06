import { Router, Context } from "oak";
import { supabase, getSupabaseAdmin } from "../db/supabaseClient.ts";
import { Recording } from "../db/models.ts";

// Define a helper type that includes the params property
type RouterContext = Context & {
    params: {
        [key: string]: string; // IDs are now numbers but come as strings from params
    };
};

// Constants for Supabase Storage
const IMAGE_BUCKET = "session-images";

const router = new Router();

// GET /api/recordings?user_id=<number> - List recordings for a user
router.get("/", async (ctx: Context) => {
    const userIdStr = ctx.request.url.searchParams.get('user_id');

    if (!userIdStr) {
        ctx.response.status = 400;
        ctx.response.body = { error: "user_id query parameter is required" };
        return;
    }

    const userId = parseInt(userIdStr);
    if (isNaN(userId)) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Invalid user_id format" };
        return;
    }

    const { data, error } = await supabase
        .from('recordings')
        .select('*')
        .eq('user_id', userId) // Filter by user_id
        .order('start_time', { ascending: true });

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to fetch recordings", message: error.message };
        return;
    }
    ctx.response.body = data;
});

// GET /api/recordings/:id - Get a specific recording by its numeric ID
router.get("/:id", async (ctx: RouterContext) => {
    const idStr = ctx.params.id;
    const id = parseInt(idStr);

    if (isNaN(id)) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Invalid Recording ID format" };
        return;
    }

    // TODO: Add security check (user ownership)
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

// POST /api/recordings - Create a new recording linked to a user
router.post("/", async (ctx: Context) => {
    try {
        const body = await ctx.request.body.json();
        const { user_id, start_time } = body as Partial<Recording>; // Expect user_id now

        // Basic validation
        if (user_id === undefined || user_id === null) { // Check for existence
            ctx.response.status = 400;
            ctx.response.body = { error: "user_id is required" };
            return;
        }
        // Ensure user_id is a number
        if (typeof user_id !== 'number') {
            ctx.response.status = 400;
            ctx.response.body = { error: "user_id must be a number" };
            return;
        }


        // Use provided start_time or current time
        const recordingStartTime = start_time || new Date().toISOString();

        // TODO: Validate user_id exists in the users table

        const { data, error } = await supabase
            .from('recordings')
            .insert([{
                user_id, // Use user_id
                start_time: recordingStartTime,
                // No end_time - will be set when recording is completed/finalized
            }])
            .select()
            .single();

        if (error) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Failed to create recording", message: error.message };
            return;
        }

        ctx.response.status = 201;
        ctx.response.body = data; // Returns the new recording including its BIGSERIAL id
    } catch (err) {
        console.error("Error creating recording:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during recording creation" };
    }
});

// Function to handle image uploads - updated for BIGINT IDs
async function processImageUploads(files: File[], recordingId: number, sequence: number | null = null, capturedAt: string = new Date().toISOString()) {
    const results = [];
    const recordingIdStr = recordingId.toString(); // For file path

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileExt = file.name.split('.').pop();
        // Use string version of ID for path if desired, or keep number
        const filePath = `${recordingIdStr}/${crypto.randomUUID()}.${fileExt}`;

        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await getSupabaseAdmin().storage
            .from(IMAGE_BUCKET)
            .upload(filePath, file, {
                contentType: file.type,
                cacheControl: '3600',
                upsert: false
            });

        if (uploadError) {
            console.error("Storage error:", uploadError);
            continue; // Skip to next file on error
        }

        // Save to database
        const { data: dbData, error: dbError } = await supabase
            .from('images')
            .insert([{
                recording_id: recordingId, // Pass the numeric ID
                file_path: uploadData.path,
                sequence: sequence !== null ? sequence + i : i, // Increment sequence
                captured_at: capturedAt
            }])
            .select()
            .single();

        if (dbError) {
            console.error("DB error:", dbError);
            // Attempt to remove the uploaded file if DB insert fails
            await getSupabaseAdmin().storage.from(IMAGE_BUCKET).remove([filePath]);
            continue;
        }

        results.push(dbData);
    }

    return results;
}

// POST /api/recordings/:id/finalize - Finalize a recording, upload images and generate script
router.post("/:id/finalize", async (ctx: RouterContext) => {
    try {
        const idStr = ctx.params.id;
        const id = parseInt(idStr); // Use numeric ID

        if (isNaN(id)) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Invalid Recording ID format" };
            return;
        }

        // Get recording data (user_id is now needed for VLM context if used)
        const { data: recordingData, error: recordingError } = await supabase
            .from('recordings')
            .select('user_id') // Select user_id instead of session_id
            .eq('id', id)
            .single();

        if (recordingError || !recordingData) {
            ctx.response.status = recordingError?.code === 'PGRST116' ? 404 : 500;
            ctx.response.body = {
                error: recordingError?.code === 'PGRST116' ? "Recording not found" : "Failed to fetch recording",
                message: recordingError?.message
            };
            return;
        }

        // End the recording if it hasn't been ended yet
        const { error: endError } = await supabase
            .from('recordings')
            .update({ end_time: new Date().toISOString() })
            .eq('id', id)
            .is('end_time', null); // Only update if not already ended

        if (endError) {
            // Log error but proceed with finalization
            console.error(`Error marking recording ${id} as ended:`, endError);
        }

        // Check if we need to upload images
        let uploadedImages: any[] = [];
        if (ctx.request.hasBody) {
            const contentType = ctx.request.headers.get("content-type") || "";
            if (contentType.includes("multipart/form-data")) {
                try {
                    const formData = await ctx.request.body.formData();
                    const fileEntries = formData.getAll("files");
                    const files = fileEntries.filter(entry => entry instanceof File) as File[];

                    if (files.length > 0) {
                        const sequenceEntry = formData.get("sequence");
                        const sequence = sequenceEntry ? parseInt(sequenceEntry as string) : null;
                        const capturedAtEntry = formData.get("captured_at");
                        const capturedAt = capturedAtEntry ? (capturedAtEntry as string) : new Date().toISOString();

                        // Process uploads with numeric recording ID
                        uploadedImages = await processImageUploads(files, id, sequence, capturedAt);

                        if (uploadedImages.length === 0 && files.length > 0) {
                            // If files were provided but none were successfully processed
                            throw new Error("Failed to process any uploaded images.");
                        }
                    }
                } catch (uploadErr) {
                    console.error("Error processing image upload during finalize:", uploadErr);
                    ctx.response.status = 500;
                    ctx.response.body = { error: "Failed to process image upload", message: uploadErr.message };
                    return;
                }
            }
        }

        // Confirm images exist for the recording before calling VLM
        const { count, error: countError } = await supabase
            .from('images')
            .select('id', { count: 'exact', head: true })
            .eq('recording_id', id);

        if (countError) {
            console.error("Error checking image count:", countError);
            ctx.response.status = 500;
            ctx.response.body = { error: "Failed to check images for recording", message: countError.message };
            return;
        }

        if (!count || count === 0) {
            // If no images were previously associated and none were uploaded now
            ctx.response.status = 400;
            ctx.response.body = { error: "No images found or uploaded for this recording, cannot generate script" };
            return;
        }

        // Call the VLM analyze endpoint
        const analyzeUrl = `${Deno.env.get("SERVER_URL") || 'http://localhost:8002'}/api/vlm/analyze`;
        console.log(`Calling VLM analyze for recording_id: ${id}, user_id: ${recordingData.user_id}`); // Log relevant IDs
        const analyzeResponse = await fetch(analyzeUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                recording_id: id,
                user_id: recordingData.user_id, // Pass user_id if needed by VLM prompt/logic
                use_default_prompt: true // Or determine dynamically
            })
        });

        const analyzeResult = await analyzeResponse.json();

        if (!analyzeResponse.ok) {
            console.error("VLM analyze error:", analyzeResult);
            ctx.response.status = 500; // Or use analyzeResponse.status
            ctx.response.body = {
                error: "Failed to analyze images and generate script",
                details: analyzeResult
            };
            // Should we revert the end_time update? Maybe not critical.
            return;
        }

        // Success: Return the final state
        const responsePayload = {
            message: "Recording finalized and script generated successfully",
            recording_id: id,
            script: analyzeResult.script // Assuming VLM returns the created script record
        };
        if (uploadedImages.length > 0) {
            Object.assign(responsePayload, { uploaded_images: uploadedImages });
        }
        ctx.response.body = responsePayload;

    } catch (err) {
        console.error(`Error finalizing recording ${ctx.params.id}:`, err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during recording finalization", message: err.message };
    }
});


export default router; 