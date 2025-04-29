import { Router, Context } from "oak";

const router = new Router();
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-3-5-sonnet-20240620";

// Tool definitions with proper input_schema
const tools = [
    {
        name: "click",
        description: "Click on an element",
        input_schema: {
            type: "object",
            properties: {
                coordinates: {
                    type: "object",
                    description: "Coordinates for clicking at a specific position",
                    properties: {
                        x: {
                            type: "number",
                            description: "X coordinate"
                        },
                        y: {
                            type: "number",
                            description: "Y coordinate"
                        }
                    },
                    required: ["x", "y"]
                }
            },
            required: ["selector"]
        }
    },
    {
        name: "navigate",
        description: "Navigate to a URL",
        input_schema: {
            type: "object",
            properties: {
                url: {
                    type: "string",
                    description: "URL to navigate to"
                }
            },
            required: ["url"]
        }
    }
];

// Main endpoint for computer use function calling
router.post("/function-call", async (ctx: Context) => {
    try {
        if (!ctx.request.hasBody) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Request body is required" };
            return;
        }

        const body = await ctx.request.body.json();
        const { markdown, screenshot, screen_size } = body;

        // Get the API key from environment variable
        const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
        if (!apiKey) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Missing ANTHROPIC_API_KEY environment variable" };
            return;
        }

        const response = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: 8192,
                temperature: 0,
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "You control a browser via exactly two tools:\n" +
                                    "1) click(selector: string) - with optional coordinates\n" +
                                    "2) navigate(url: string)\n\n" +
                                    "Given the following markdown instruction:\n\n" +
                                    markdown +
                                    "\n\nAnalyze the screenshot and determine the appropriate action. " +
                                    "Response with a tool call or a message depending on how many steps we have.\n\n" +
                                    "If you are calling a function, your message should be the next steps after we use call the tool. " +
                                    "Only include the fields you need: use `toolCall` if you want the client to execute a tool, " +
                                    "or `message` when the task is complete. " +
                                    "If clicking, try to provide coordinates when possible.\n" +
                                    "This is the current screensize for reference: " + screen_size + ".\n" +
                                    "If you are in the iteration +1, you should check the mouse position in the screenshot and adapt the coordinates accordingly."
                            },
                            {
                                type: "image",
                                source: {
                                    type: "base64",
                                    media_type: "image/png",
                                    data: screenshot.replace(/^data:image\/png;base64,/, "")
                                }
                            }
                        ]
                    }
                ],
                tools
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            ctx.response.status = response.status;
            ctx.response.body = { error: `Anthropic API error: ${response.status} ${errorText}` };
            return;
        }

        const data = await response.json();

        // Extract the toolCall and message fields from the response content
        const assistantContent = data?.content || [];
        let toolCall: { name: string; input: object } | null = null;
        let message = "";

        for (const item of assistantContent) {
            if (item.type === "tool_use") {
                toolCall = {
                    name: item.name,
                    input: item.input
                };
            } else if (item.type === "text") {
                message += item.text;
            }
        }

        ctx.response.body = {
            toolCall,
            message: message.trim() || "No message provided by the model"
        };

    } catch (err) {
        const error = err as Error;
        console.error("Error calling Anthropic API:", error);
        ctx.response.status = 500;
        ctx.response.body = { error: error.message || "Unknown error" };
    }
});

// Endpoint to handle tool result and continue conversation
router.post("/tool-result", async (ctx: Context) => {
    try {
        if (!ctx.request.hasBody) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Request body is required" };
            return;
        }

        const body = await ctx.request.body.json();
        const { toolUseId, result, previousMessages } = body;

        // Get the API key from environment variable
        const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
        if (!apiKey) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Missing ANTHROPIC_API_KEY environment variable" };
            return;
        }

        // Transform previous messages: ensure that any tool use message includes an 'id' field.
        const fixedPreviousMessages = Array.isArray(previousMessages)
            ? previousMessages.map((msg: any) => {
                if (msg && Array.isArray(msg.content)) {
                    msg.content = msg.content.map((item: any) => {
                        if (item.type === "tool_use" && !item.id) {
                            // Remove tool_use_id and assign its value to id
                            const { tool_use_id, ...rest } = item;
                            return { ...rest, id: tool_use_id };
                        }
                        return item;
                    });
                }
                return msg;
            })
            : previousMessages;

        // Append the new tool result message, using a nested 'tool_use' field with an 'id'
        const messages = [
            ...fixedPreviousMessages,
            {
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: toolUseId,
                        content: JSON.stringify(result)
                    }
                ]
            }
        ];

        const response = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: 300,
                temperature: 0,
                messages,
                tools
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            ctx.response.status = response.status;
            ctx.response.body = { error: `Anthropic API error: ${response.status} ${errorText}` };
            return;
        }

        const data = await response.json();
        ctx.response.body = data;
    } catch (err) {
        const error = err as Error;
        console.error("Error sending tool result to Anthropic API:", error);
        ctx.response.status = 500;
        ctx.response.body = { error: error.message || "Unknown error" };
    }
});

export default router;
