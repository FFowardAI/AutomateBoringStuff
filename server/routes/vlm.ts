import { Router, Context } from "oak";
import { supabase, supabaseUrl } from "../db/supabaseClient.ts";

// Define a helper type that includes the params property
type RouterContext = Context & {
    params: {
        [key: string]: string;
    };
};

const router = new Router();
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-3-5-haiku-latest";

// Default prompt for automating tasks based on image sequences
const DEFAULT_AUTOMATION_PROMPT = `
Analyze these screenshots of a workflow or task and create a detailed automation script.
For each step shown in the images (ordered chronologically):
1. Identify what's happening in the interface
2. Note any clicks, inputs, or interactions
3. Include specific values, text entries, or selections made

Format your response as a clear step-by-step script that could be used to reproduce this exact workflow.
Include any relevant metadata about the task context. Be specific about what to click, what to type, 
and what the expected results should be.
`;

// POST /api/vlm/analyze - Analyze images with VLM and create script
router.post("/analyze", async (ctx: Context) => {
    try {
        if (!ctx.request.hasBody) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Request body is required" };
            return;
        }

        const body = await ctx.request.body.json();

        // Required request parameters
        const { recording_id, session_id, custom_prompt, use_default_prompt = true } = body;

        if (!recording_id) {
            ctx.response.status = 400;
            ctx.response.body = { error: "recording_id is required" };
            return;
        }

        if (!session_id) {
            ctx.response.status = 400;
            ctx.response.body = { error: "session_id is required" };
            return;
        }

        // Get the API key from environment variable
        const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
        if (!apiKey) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Anthropic API key not configured" };
            return;
        }

        // Determine which prompt to use
        const prompt = use_default_prompt
            ? (custom_prompt ? `${DEFAULT_AUTOMATION_PROMPT}\n\n${custom_prompt}` : DEFAULT_AUTOMATION_PROMPT)
            : custom_prompt;

        if (!use_default_prompt && !custom_prompt) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Either use_default_prompt must be true or custom_prompt must be provided" };
            return;
        }

        // Fetch all images for the recording
        const { data: imagesData, error: imagesError } = await supabase
            .from('images')
            .select('id, file_path, sequence, captured_at')
            .eq('recording_id', recording_id)
            .order('sequence', { ascending: true, nullsFirst: false })
            .order('captured_at', { ascending: true });

        if (imagesError || !imagesData || imagesData.length === 0) {
            ctx.response.status = imagesError ? 500 : 404;
            ctx.response.body = {
                error: imagesError ? "Failed to fetch images" : "No images found for the recording",
                message: imagesError?.message
            };
            return;
        }

        // Get session context if available
        const { data: sessionData, error: sessionError } = await supabase
            .from('sessions')
            .select('context')
            .eq('id', session_id)
            .single();

        if (sessionError && sessionError.code !== 'PGRST116') {
            console.error("Error fetching session data:", sessionError);
            // Continue even if this fails
        }

        // Prepare the content array for the Anthropic API
        const contentArray = [];

        // Add a text introduction including session context if available
        contentArray.push({
            type: "text",
            text: `Analyzing a sequence of ${imagesData.length} images showing a workflow. ` +
                (sessionData?.context ? `Session context: ${sessionData.context}` : '')
        });

        // Add each image to the content array
        for (const image of imagesData) {
            // Get direct public URL
            const imageUrl = `${supabaseUrl}/storage/v1/object/public/session-images/${image.file_path}`;

            contentArray.push({
                type: "image",
                source: {
                    type: "url",
                    url: imageUrl
                }
            });
        }

        // Add the prompt as the final text element
        contentArray.push({
            type: "text",
            text: prompt
        });
        console.log("contentArray ", contentArray);
        // Format the request for Anthropic API
        const anthropicRequest = {
            max_tokens: 8192,
            model: MODEL,
            messages: [
                {
                    role: "user",
                    content: contentArray
                }
            ]
        };
        console.log("body ", anthropicRequest);
        // Call the Anthropic API
        const response = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify(anthropicRequest)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Anthropic API error:", errorData);
            ctx.response.status = response.status;
            ctx.response.body = {
                error: "Failed to analyze images with Anthropic API",
                details: errorData
            };
            return;
        }

        const result = await response.json();

        // Extract the script content from the result
        const scriptContent = result.content[0].text;

        // Create a new script record in the database
        const { data: scriptData, error: scriptError } = await supabase
            .from('scripts')
            .insert([{
                session_id,
                content: scriptContent,
                status: 'completed'
            }])
            .select()
            .single();

        if (scriptError) {
            console.error("Failed to save script:", scriptError);
            ctx.response.status = 500;
            ctx.response.body = {
                error: "Failed to save generated script",
                message: scriptError.message
            };
            return;
        }

        // Return the script data and analysis to the client
        ctx.response.body = {
            recording_id,
            session_id,
            model: MODEL,
            script: scriptData,
            analysis: result
        };

    } catch (err) {
        console.error("Error in VLM analysis:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during image analysis" };
    }
});

// POST /api/vlm/batch-analyze - Analyze multiple images in a recording
router.post("/batch-analyze", async (ctx: Context) => {
    try {
        if (!ctx.request.hasBody) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Request body is required" };
            return;
        }

        const body = await ctx.request.body.json();

        // Required request parameters
        const { recording_id, prompt, limit = 5 } = body;

        if (!recording_id) {
            ctx.response.status = 400;
            ctx.response.body = { error: "recording_id is required" };
            return;
        }

        if (!prompt) {
            ctx.response.status = 400;
            ctx.response.body = { error: "prompt is required" };
            return;
        }

        // Get the API key from environment variable
        const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
        if (!apiKey) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Anthropic API key not configured" };
            return;
        }

        // Fetch the most recent images from the recording (limited by 'limit')
        const { data: imagesData, error: imagesError } = await supabase
            .from('images')
            .select('id, file_path')
            .eq('recording_id', recording_id)
            .order('captured_at', { ascending: false })
            .limit(limit);

        if (imagesError) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Failed to fetch images", message: imagesError.message };
            return;
        }

        if (!imagesData || imagesData.length === 0) {
            ctx.response.status = 404;
            ctx.response.body = { error: "No images found for this recording" };
            return;
        }

        // Process each image sequentially
        const results = [];
        for (const image of imagesData) {
            // Get a signed URL for the image
            const { data: urlData, error: urlError } = await supabase.storage
                .from('session-images')
                .createSignedUrl(image.file_path, 60 * 5); // URL valid for 5 minutes

            if (urlError || !urlData) {
                console.error(`Failed to generate URL for image ${image.id}:`, urlError);
                continue; // Skip this image
            }

            // Format the request for Anthropic API
            const anthropicRequest = {
                model: MODEL,
                max_tokens: 1024,
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "image",
                                source: {
                                    type: "url",
                                    url: urlData.signedUrl
                                }
                            },
                            {
                                type: "text",
                                text: prompt
                            }
                        ]
                    }
                ]
            };

            // Call the Anthropic API
            const response = await fetch(ANTHROPIC_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01"
                },
                body: JSON.stringify(anthropicRequest)
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error(`Anthropic API error for image ${image.id}:`, errorData);
                continue; // Skip this image
            }

            const result = await response.json();

            // Save the analysis result to the database (optional)
            const { data: analysisData, error: analysisError } = await supabase
                .from('image_analyses')
                .insert([{
                    image_id: image.id,
                    model: MODEL,
                    prompt,
                    result: result
                }])
                .select()
                .single();

            if (analysisError) {
                console.error(`Failed to save analysis result for image ${image.id}:`, analysisError);
                // Continue even if saving fails
            }

            results.push({
                image_id: image.id,
                analysis: result
            });
        }

        // Return the results to the client
        ctx.response.body = {
            recording_id,
            model: MODEL,
            results
        };

    } catch (err) {
        console.error("Error in batch VLM analysis:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during batch image analysis" };
    }
});

export default router; 