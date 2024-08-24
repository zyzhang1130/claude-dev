import { Anthropic } from "@anthropic-ai/sdk"
import { ApiConfiguration, ApiModelId, ModelInfo } from "../shared/api"
import { AnthropicHandler } from "./anthropic"
import { AwsBedrockHandler } from "./bedrock"
import { OpenRouterHandler } from "./openrouter"
import { OpenAIHandler } from "./openai"

export interface ApiHandler {
	createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		tools: Anthropic.Messages.Tool[]
	): Promise<Anthropic.Messages.Message>

	createUserReadableRequest(
		userContent: Array<
			| Anthropic.TextBlockParam
			| Anthropic.ImageBlockParam
			| Anthropic.ToolUseBlockParam
			| Anthropic.ToolResultBlockParam
		>
	): any

	getModel(): { id: ApiModelId; info: ModelInfo }
}

export function buildApiHandler(configuration: ApiConfiguration): ApiHandler {
	const { apiProvider, ...options } = configuration
	console.log(`Building API handler for provider: ${apiProvider}`)
	console.log(`Configuration options:`, JSON.stringify(options))
	
	let handler: ApiHandler
	switch (apiProvider) {
		case "anthropic":
			handler = new AnthropicHandler(options)
			break
		case "openrouter":
			handler = new OpenRouterHandler(options)
			break
		case "bedrock":
			handler = new AwsBedrockHandler(options)
			break
		case "openai":
			console.log("Creating OpenAIHandler")
			handler = new OpenAIHandler(options)
			console.log("OpenAIHandler created successfully")
			break
		default:
			console.log("Using default AnthropicHandler")
			handler = new AnthropicHandler(options)
	}
	
	console.log("Handler built successfully")
	return handler
}

export function withoutImageData(
	userContent: Array<
		| Anthropic.TextBlockParam
		| Anthropic.ImageBlockParam
		| Anthropic.ToolUseBlockParam
		| Anthropic.ToolResultBlockParam
	>
): Array<
	Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam
> {
	return userContent.map((part) => {
		if (part.type === "image") {
			return { ...part, source: { ...part.source, data: "..." } }
		} else if (part.type === "tool_result" && typeof part.content !== "string") {
			return {
				...part,
				content: part.content?.map((contentPart) => {
					if (contentPart.type === "image") {
						return { ...contentPart, source: { ...contentPart.source, data: "..." } }
					}
					return contentPart
				}),
			}
		}
		return part
	})
}
