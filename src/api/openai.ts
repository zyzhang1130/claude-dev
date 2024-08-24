import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "."
import { ApiConfiguration, ApiModelId, ModelInfo } from "../shared/api"

export class OpenAIHandler implements ApiHandler {
	private client: OpenAI
	private model: string

	constructor(configuration: ApiConfiguration) {
		this.client = new OpenAI({
			apiKey: configuration.apiKey,
		})
		this.model = configuration.model || "gpt-4-vision-preview"
	}

	async createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		tools: Anthropic.Messages.Tool[]
	): Promise<Anthropic.Messages.Message> {
		const openaiMessages = [
			{ role: "system", content: systemPrompt },
			...messages.map((msg) => ({
				role: msg.role === "assistant" ? "assistant" : "user",
				content: this.convertContent(msg.content),
			})),
		]

		const response = await this.client.chat.completions.create({
			model: this.model,
			messages: openaiMessages,
			functions: tools.map((tool) => ({
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters,
			})),
		})

		const choice = response.choices[0]
		return {
			role: "assistant",
			content: choice.message?.content || "",
			model: this.model,
			stop_reason: choice.finish_reason || undefined,
			usage: {
				input_tokens: response.usage?.prompt_tokens || 0,
				output_tokens: response.usage?.completion_tokens || 0,
			},
		}
	}

	createUserReadableRequest(
		userContent: Array<
			| Anthropic.TextBlockParam
			| Anthropic.ImageBlockParam
			| Anthropic.ToolUseBlockParam
			| Anthropic.ToolResultBlockParam
		>
	): any {
		return {
			model: this.model,
			messages: [{ role: "user", content: this.convertContent(userContent) }],
		}
	}

	getModel(): { id: ApiModelId; info: ModelInfo } {
		return {
			id: this.model as ApiModelId,
			info: {
				name: this.model,
				description: "OpenAI GPT model",
				contextLength: 8192, // Adjust based on the specific model
			},
		}
	}

	private convertContent(
		content: Array<
			| Anthropic.TextBlockParam
			| Anthropic.ImageBlockParam
			| Anthropic.ToolUseBlockParam
			| Anthropic.ToolResultBlockParam
		>
	): Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> {
		return content.map((item) => {
			switch (item.type) {
				case "text":
					return { type: "text", text: item.text }
				case "image":
					return { type: "image_url", image_url: { url: `data:${item.source.media_type};base64,${item.source.data}` } }
				case "tool_use":
				case "tool_result":
					// Convert tool use and result to text
					return { type: "text", text: JSON.stringify(item) }
			}
		})
	}
}