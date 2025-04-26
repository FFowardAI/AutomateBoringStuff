import { Router, Context } from "oak";
import { supabase, getSupabaseAdmin } from "../db/supabaseClient.ts";
import { Image } from "../db/models.ts";

// Define a helper type that includes the params property
type RouterContext = Context & {
    params: {
        [key: string]: string;
    };
};

const router = new Router();

// Constants for Supabase Storage
const IMAGE_BUCKET = "session-images"; // Replace with your actual bucket name

// GET /api/images?recording_id=<uuid> - List images for a recording
router.get("/", async (ctx: Context) => {
    const recordingId = ctx.request.url.searchParams.get('recording_id');

    if (!recordingId) {
        ctx.response.status = 400;
        ctx.response.body = { error: "recording_id query parameter is required" };
        return;
    }

    // TODO: Security check: Does user own the parent recording/session?
    const { data, error } = await supabase
        .from('images')
        .select('id, recording_id, sequence, captured_at, file_path') // Select specific fields
        .eq('recording_id', recordingId)
        .order('sequence', { ascending: true, nullsFirst: false })
        .order('captured_at', { ascending: true });

    if (error) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to fetch images", message: error.message };
        return;
    }

    // Optionally generate signed URLs for accessing the images
    // const imagesWithUrls = await Promise.all(data.map(async (img) => {
    //     const { data: urlData, error: urlError } = await supabase.storage
    //         .from(IMAGE_BUCKET)
    //         .createSignedUrl(img.file_path, 60 * 60); // Link valid for 1 hour
    //     return { ...img, signedUrl: urlError ? null : urlData?.signedUrl };
    // }));
    // ctx.response.body = imagesWithUrls;

    ctx.response.body = data; // Return paths for now
});

// POST /api/images - Upload a new image associated with a recording
// Expects multipart/form-data with 'file' and 'recording_id', 'sequence' (optional)
router.post("/", async (ctx: Context) => {
    try {
        if (!ctx.request.hasBody) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Request body is required (multipart/form-data)" };
            return;
        }

        const formData = await ctx.request.body.formData();
        console.log(formData);

        // Retrieve the 'file' entry from the form data using the key 'file'
        const fileEntries = formData.getAll("files");
        const files = fileEntries.filter(entry => entry instanceof File) as File[];
        console.log(files);

        if (files.length === 0) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Image files are required" };
            return;
        }

        console.log(`Processing ${files.length} files`);

        // Retrieve other form fields using FormData.get()
        const recordingIdEntry = formData.get("recording_id");
        const recordingId = typeof recordingIdEntry === "string" ? recordingIdEntry : null;

        const sequenceEntry = formData.get("sequence");
        const sequence = sequenceEntry ? parseInt(sequenceEntry as string) : null;

        const capturedAtEntry = formData.get("captured_at");
        const capturedAt = capturedAtEntry ? (capturedAtEntry as string) : new Date().toISOString(); // Allow overriding capture time

        if (files.length === 0) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Image files are required" };
            return;
        }
        if (!recordingId) {
            ctx.response.status = 400;
            ctx.response.body = { error: "recording_id field is required" };
            return;
        }

        // TODO: Validate recordingId exists and belongs to the user

        // // Create a unique file path in Supabase Storage
        // const fileExt = file.filename.split('.').pop();
        // const filePath = `${recordingId}/${uuid.generate()}.${fileExt}`;

        /// Process each file
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

        // Only return success if we actually processed some images successfully
        if (results.length === 0) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Failed to process images", details: "All upload attempts failed" };
            return;
        }

        ctx.response.status = 201;
        ctx.response.body = results;

    } catch (err) {
        console.error("Error uploading image:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during image upload" };
    }
});

// GET /api/images/:id - Get specific image metadata (not the file itself)
router.get("/:id", async (ctx: RouterContext) => {
    const id = ctx.params.id;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Image ID is required" };
        return;
    }

    // TODO: Add security check
    const { data, error } = await supabase
        .from('images')
        .select('*')
        .eq('id', id)
        .single();

    if (error || !data) {
        ctx.response.status = error?.code === 'PGRST116' ? 404 : 500;
        ctx.response.body = { error: error?.code === 'PGRST116' ? "Image metadata not found" : "Failed to fetch image metadata", message: error?.message };
        return;
    }

    // You might want to add the signed URL here too
    ctx.response.body = data;
});

// DELETE /api/images/:id - Delete image metadata and file from storage
router.delete("/:id", async (ctx: RouterContext) => {
    const id = ctx.params.id;
    if (!id) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Image ID is required" };
        return;
    }

    // TODO: Add security check

    // 1. Get file path from DB
    const { data: imageData, error: fetchError } = await supabase
        .from('images')
        .select('file_path')
        .eq('id', id)
        .single();

    if (fetchError || !imageData) {
        ctx.response.status = fetchError?.code === 'PGRST116' ? 404 : 500;
        ctx.response.body = { error: fetchError?.code === 'PGRST116' ? "Image metadata not found" : "Failed to fetch image metadata before delete", message: fetchError?.message };
        return;
    }

    // 2. Delete from DB
    const { error: dbDeleteError } = await supabase
        .from('images')
        .delete()
        .eq('id', id);

    if (dbDeleteError) {
        ctx.response.status = 500;
        ctx.response.body = { error: "Failed to delete image metadata from database", message: dbDeleteError.message };
        // Don't proceed to storage deletion if DB deletion failed
        return;
    }

    // 3. Delete from Storage (best effort, log error if it fails)
    const { error: storageDeleteError } = await getSupabaseAdmin().storage
        .from(IMAGE_BUCKET)
        .remove([imageData.file_path]);

    if (storageDeleteError) {
        // Log this error, but usually return success as the DB record is gone
        console.error(`Failed to delete image ${imageData.file_path} from storage after DB deletion:`, storageDeleteError);
    }

    ctx.response.status = 204; // No Content
});

export default router; 