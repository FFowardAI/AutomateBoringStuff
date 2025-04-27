#!/bin/bash
# Test curl examples for computer_use endpoints

# 1. Function Call endpoint
echo "Testing Function Call endpoint..."
curl -X POST http://localhost:8002/api/computer-use/function-call \
  -H "Content-Type: application/json" \
  -d '{
    "markdown": "1. Go to Google\n2. Search for \"Anthropic Claude\"\n3. Click on the first result",
    "domHtml": "<!DOCTYPE html><html><head><title>Example Page</title></head><body><div class=\"search-bar\"><input type=\"text\" placeholder=\"Search...\"></div><button>Search</button><div class=\"results\"><div class=\"result\"><a href=\"https://example.com\">Example Link</a></div></div></body></html>",
    "instruction": "Go to Google"
  }'

echo -e "\n\n"

# 2. Tool Result endpoint
echo "Testing Tool Result endpoint..."
curl -X POST http://localhost:8002/api/computer-use/tool-result \
  -H "Content-Type: application/json" \
  -d '{
    "toolUseId": "tool_123456",
    "result": { "success": true, "message": "Navigation successful" },
    "previousMessages": [
      {
        "role": "user",
        "content": "What is the next step in this process?"
      },
      {
        "role": "assistant",
        "content": [
          {
            "type": "text",
            "text": "I will help you navigate to Google."
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
  }'

# To make the script executable:
# chmod +x computer_use_curl_examples.sh 