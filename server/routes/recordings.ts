import { Router, Context } from "oak";
import { supabase, getSupabaseAdmin } from "../db/supabaseClient.ts";
import { Recording } from "../db/models.ts";

// Define a helper type that includes the params property
type RouterContext = Context & {
    params: {
        [key: string]: string;
    };
};

// Constants for Supabase Storage
const IMAGE_BUCKET = "session-images";

const router = new Router();

// GET /api/recordings?session_id=<uuid> - List recordings for a session
router.get("/", async (ctx: Context) => {
    const sessionId = ctx.request.url.searchParams.get('session_id');

    if (!sessionId) {
        ctx.response.status = 400;
        ctx.response.body = { error: "session_id query parameter is required" };
        return;
    }

    // TODO: Add security check - does the current user own the parent session?

    const { data, error } = await supabase
        .from('recordings')
        .select('*')
        .eq('session_id', sessionId)
        .order('start_time', { ascending: true });

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to fetch recordings", message: error.message };
        return;
    }
    ctx.response.body = data;
});

// GET /api/recordings/:id - Get a specific recording
router.get("/:id", async (ctx: RouterContext) => {
    const { id } = ctx.params;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Recording ID is required" };
        return;
    }

    // TODO: Add security check
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

// POST /api/recordings - Create a new recording period within a session (just start time, no end yet)
router.post("/", async (ctx: Context) => {
    try {
        const body = await ctx.request.body.json();
        const { session_id, start_time } = body as Partial<Recording>;

        // Basic validation
        if (!session_id) {
            ctx.response.status = 400;
            ctx.response.body = { error: "session_id is required" };
            return;
        }

        // Use provided start_time or current time
        const recordingStartTime = start_time || new Date().toISOString();

        // TODO: Validate session_id exists and belongs to user

        const { data, error } = await supabase
            .from('recordings')
            .insert([{
                session_id,
                start_time: recordingStartTime,
                // No end_time - will be set when recording is completed
            }])
            .select()
            .single();

        if (error) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Failed to create recording", message: error.message };
            return;
        }

        ctx.response.status = 201;
        ctx.response.body = data;
    } catch (err) {
        console.error("Error creating recording:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during recording creation" };
    }
});

// Function to handle image uploads - extracted from the images route
async function processImageUploads(files: File[], recordingId: string, sequence: number | null = null, capturedAt: string = new Date().toISOString()) {
    const results = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileExt = file.name.split('.').pop();
        const filePath = `${recordingId}/${crypto.randomUUID()}.${fileExt}`;

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
                recording_id: recordingId,
                file_path: uploadData.path,
                sequence: sequence !== null ? sequence + i : i, // Increment sequence
                captured_at: capturedAt
            }])
            .select()
            .single();

        if (dbError) {
            console.error("DB error:", dbError);
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
        const { id } = ctx.params;
        if (!id) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Recording ID is required" };
            return;
        }

        // Get recording data
        const { data: recordingData, error: recordingError } = await supabase
            .from('recordings')
            .select('session_id')
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
            .is('end_time', null);

        if (endError) {
            console.error("Error ending recording:", endError);
            // Continue anyway
        }

        // Check if we need to upload images
        let uploadedImages: any[] = [];

        if (ctx.request.hasBody) {
            const contentType = ctx.request.headers.get("content-type") || "";

            if (contentType.includes("multipart/form-data")) {
                try {
                    const formData = await ctx.request.body.formData();

                    // Extract files and parameters
                    const fileEntries = formData.getAll("files");
                    const files = fileEntries.filter(entry => entry instanceof File) as File[];

                    if (files.length > 0) {
                        // Get sequence and captured_at if present
                        const sequenceEntry = formData.get("sequence");
                        const sequence = sequenceEntry ? parseInt(sequenceEntry as string) : null;

                        const capturedAtEntry = formData.get("captured_at");
                        const capturedAt = capturedAtEntry ? (capturedAtEntry as string) : new Date().toISOString();

                        // Process the image uploads directly
                        uploadedImages = await processImageUploads(files, id, sequence, capturedAt);

                        if (uploadedImages.length === 0) {
                            ctx.response.status = 500;
                            ctx.response.body = { error: "Failed to upload images" };
                            return;
                        }
                    }
                } catch (uploadErr) {
                    console.error("Error processing image upload:", uploadErr);
                    ctx.response.status = 500;
                    ctx.response.body = { error: "Failed to process image upload" };
                    return;
                }
            }
        }

        // Fetch the images count to confirm we have images to analyze
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
            ctx.response.status = 400;
            ctx.response.body = { error: "No images found for this recording, cannot generate script" };
            return;
        }

        // Now call the VLM analyze endpoint
        const analyzeUrl = `${Deno.env.get("SERVER_URL") || 'http://localhost:8002'}/api/vlm/analyze`;
        const analyzeResponse = await fetch(analyzeUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                recording_id: id,
                session_id: recordingData.session_id,
                use_default_prompt: true
            })
        });

        const analyzeResult = await analyzeResponse.json();

        if (!analyzeResponse.ok) {
            console.error("VLM analyze error:", analyzeResult);
            ctx.response.status = 500;
            ctx.response.body = {
                error: "Failed to analyze images and generate script",
                details: analyzeResult
            };
            return;
        }

        // Return successful response with the uploaded images and script data
        const response = {
            message: "Recording finalized and script generated successfully",
            recording_id: id,
            script: analyzeResult.script
        };

        // Add uploaded_images to the response if we uploaded any
        if (uploadedImages.length > 0) {
            Object.assign(response, { uploaded_images: uploadedImages });
        }

        ctx.response.body = response;

    } catch (err) {
        console.error("Error finalizing recording:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during recording finalization" };
    }
});

// Add PUT/DELETE if modification/deletion of recording periods is needed.

export default router; 