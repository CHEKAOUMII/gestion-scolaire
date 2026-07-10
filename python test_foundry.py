import os
from anthropic import AnthropicFoundry

endpoint = "https://k139526780-6671-resource.services.ai.azure.com/anthropic"
deployment_name = "claude-opus-4-8"

# Reads the API key from an environment variable instead of hardcoding it.
# Set it in your terminal before running this script:
#   PowerShell:  $env:FOUNDRY_API_KEY="your-key-here"
#   CMD:         set FOUNDRY_API_KEY=your-key-here
api_key = os.environ.get("0RQav2o7A1pfO7JvHH53aezIWYtMeCHPjr5uZtWWyFA73SmXBeKAJQQJ99CGACfhMk5XJ3w3AAAAACOGJU0L")

if not api_key:
    raise ValueError(
        "FOUNDRY_API_KEY environment variable not set. "
        "Set it in your terminal before running this script."
    )

client = AnthropicFoundry(
    api_key=api_key,
    base_url=endpoint
)

message = client.messages.create(
    model=deployment_name,
    messages=[
        {"role": "user", "content": "What is the capital of France?"}
    ],
    max_tokens=1024,
)

print(message.content)