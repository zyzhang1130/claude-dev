import { Anthropic } from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { v4 as uuidv4 } from 'uuid';  // UUID generation library
import { ApiHandler } from ".";
import { ApiConfiguration, ApiModelId, ModelInfo, OpenAIModelId, openAIModels } from "../shared/api";

// Define the types for the content blocks
interface TextBlockParam {
    type: "text";
    text: string;
}

interface ImageBlockParam {
    type: "image";
    source: {
        media_type: string;
        data: string;
    };
}

interface ToolUseBlockParam {
    type: "tool_use";
    // other properties specific to tool use
}

interface ToolResultBlockParam {
    type: "tool_result";
    // other properties specific to tool result
}

type ContentBlockParam = TextBlockParam | ImageBlockParam | ToolUseBlockParam | ToolResultBlockParam;

export class OpenAIHandler implements ApiHandler {
    private client: OpenAI;
    private model: OpenAIModelId;

    constructor(configuration: ApiConfiguration) {
        console.log("Initializing OpenAIHandler");
        console.log("Configuration:", JSON.stringify(configuration));

        if (!configuration.apiKey) {
            console.error("OpenAI API key is missing");
            throw new Error("OpenAI API key is required");
        }

        this.client = new OpenAI({
            apiKey: configuration.apiKey,
        });
        this.model = (configuration.apiModelId as OpenAIModelId) || "gpt-4o-2024-08-06";

        if (!openAIModels[this.model]) {
            console.error(`Invalid OpenAI model: ${this.model}`);
            throw new Error(`Invalid OpenAI model: ${this.model}`);
        }
        console.log(`OpenAIHandler initialized with model: ${this.model}`);
    }

    async createMessage(
        systemPrompt: string,
        messages: Anthropic.Messages.MessageParam[],
        tools: Anthropic.Messages.Tool[]
    ): Promise<Anthropic.Messages.Message> {
        console.log("Creating message with OpenAI");

        const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            ...messages.map((msg) => {
                let content: string;

                if (Array.isArray(msg.content)) {
                    content = this.convertContent(msg.content).map(item => item.text || item.image_url?.url).join("\n");
                } else {
                    content = msg.content as string;  // If it's already a string, use it directly
                }

                return {
                    role: msg.role === "assistant" ? "assistant" : "user",
                    content: content,
                } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
            }),
        ];

        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: openaiMessages,
            functions: tools.map((tool) => ({
                name: tool.name, 
                description: tool.description, 
                // parameters: tool.parameters, // Commented out since not directly needed
            })),
        });

        const choice = response.choices[0];
        console.log("OpenAI response received");

        return {
            id: uuidv4(),  // Generate a unique ID
            role: "assistant",
            content: this.convertToContentBlock(choice.message?.content || ""),
            model: this.model,
            stop_reason: this.mapFinishReason(choice.finish_reason),
            stop_sequence: null,  // Set an appropriate value if needed
            type: "message",  // Assuming 'message' is the correct type
            usage: {
                input_tokens: response.usage?.prompt_tokens || 0,
                output_tokens: response.usage?.completion_tokens || 0,
            },
        } as Anthropic.Messages.Message;
    }

    createUserReadableRequest(
        userContent: Array<
            | Anthropic.TextBlockParam
            | Anthropic.ImageBlockParam
            | Anthropic.ToolUseBlockParam
            | Anthropic.ToolResultBlockParam
        >
    ): any {
        console.log("Creating user readable request for OpenAI");

        return {
            model: this.model,
            messages: [
                { role: "user", content: this.convertContent(userContent).map(item => item.text || item.image_url?.url).join("\n") }
            ],
        };
    }

    getModel(): { id: ApiModelId; info: ModelInfo } {
        console.log(`Getting model info for: ${this.model}`);
        return {
            id: this.model,
            info: openAIModels[this.model],
        };
    }

    private convertContent(
        content: ContentBlockParam[]
    ): Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> {
        console.log("Converting content for OpenAI");

        return content.map((item) => {
            switch (item.type) {
                case "text":
                    return { type: "text", text: item.text };
                case "image":
                    return { type: "image_url", image_url: { url: `data:${item.source.media_type};base64,${item.source.data}` } };
                case "tool_use":
                case "tool_result":
                    // Convert tool use and result to text
                    return { type: "text", text: JSON.stringify(item) };
                default:
                    throw new Error(`Unsupported content type: ${(item as ContentBlockParam).type}`);
            }
        });
    }

    private convertToContentBlock(content: string): Anthropic.Messages.ContentBlock[] {
        // Assuming ContentBlock is an object with a `type` and `text` field
        return [{ type: "text", text: content }];
    }

    private mapFinishReason(finishReason: string): "tool_use" | "end_turn" | "max_tokens" | "stop_sequence" | null {
        // Map OpenAI finish_reason to Anthropic stop_reason
        switch (finishReason) {
            case "stop":
            case "length":
            case "max_tokens":
                return "max_tokens"; // Example mapping, adjust as needed
            case "tool_calls":
            case "function_call":
                return "tool_use";
            case "content_filter":
                return "stop_sequence"; // Adjust based on actual mapping
            default:
                return null; // Or another default appropriate value
        }
    }
}
