# Computer Use API

This API provides endpoints for function calling with Anthropic's Claude API, allowing automation of browser actions.

## Setup

1. Ensure your Anthropic API key is set in the environment variables as `ANTHROPIC_API_KEY`
2. The server should be running on port 8002 (default)

## Endpoints

### 1. Function Call

Determines which DOM action to take based on a todo list, DOM HTML, and the current instruction.

- **URL**: `/api/computer-use/function-call`
- **Method**: `POST`
- **Body**:
  ```json
  {
    "markdown": "1. Go to Google\n2. Search for 'Anthropic Claude'\n3. Click on the first result",
    "domHtml": "<html>...</html>",
    "instruction": "Go to Google"
  }
  ```

- **Response**:
  ```json
  {
    "toolCall": {
      "tool_use_id": "tool_123456",
      "name": "navigate",
      "input": {
        "url": "https://www.google.com"
      }
    }
  }
  ```

### 2. Tool Result

Sends the result of a tool execution back to Claude to continue the conversation.

- **URL**: `/api/computer-use/tool-result`
- **Method**: `POST`
- **Body**:
  ```json
  {
    "toolUseId": "tool_123456",
    "result": { "success": true, "message": "Navigation successful" },
    "previousMessages": [
      {
        "role": "user",
        "content": "What's the next step in this process?"
      },
      {
        "role": "assistant",
        "content": [
          {
            "type": "text",
            "text": "I'll help you navigate to Google."
          },
          {
            "type": "tool_use",
            "tool_use_id": "tool_123456",
            "name": "navigate",
            "input": {
              "url": "https://www.google.com"
            }
          }
        ]
      }
    ]
  }
  ```

- **Response**:
  Claude's next message in the conversation based on the tool result.

## Example Flow

1. Send a function call request with the todo list, DOM HTML, and current instruction
2. Receive a tool call response (navigate or click)
3. Execute the action in the browser or extension
4. Send the result back using tool-result endpoint
5. Receive the next instruction from Claude

## Testing

Use the provided Postman collection (`server/computer_use_postman.json`) to test these endpoints.

1. Import the collection into Postman
2. Update the request bodies as needed for your specific test scenario
3. Execute the requests to see the responses from Claude

## Supported Tools

The API supports the following tools with their required input schemas:

### navigate

Navigate to a specified URL.

```json
{
  "name": "navigate",
  "description": "Navigate to a URL",
  "input_schema": {
    "type": "object",
    "properties": {
      "url": {
        "type": "string",
        "description": "URL to navigate to"
      }
    },
    "required": ["url"]
  }
}
```

Example input:
```json
{
  "url": "https://www.example.com"
}
```

### click

Click on a DOM element using a CSS selector.

```json
{
  "name": "click",
  "description": "Click on a DOM element",
  "input_schema": {
    "type": "object",
    "properties": {
      "selector": {
        "type": "string",
        "description": "CSS selector for the element to click"
      }
    },
    "required": ["selector"]
  }
}
```

Example input:
```json
{
  "selector": ".search-button"
}
```

## Common Errors

- **Missing input_schema**: Anthropic requires an input_schema for each tool. If you get an error like `tools.0.custom.input_schema: Field required`, check that your tool definitions include the proper input_schema.
- **API Key Issues**: Ensure your Anthropic API key is properly set in the environment variables.
- **Malformed JSON**: Double-check that all JSON payloads are properly formatted. 