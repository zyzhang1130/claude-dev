import { Anthropic } from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { v4 as uuidv4 } from 'uuid';
import { ApiHandler } from ".";
import { ApiConfiguration, ApiModelId, ModelInfo, OpenAIModelId, openAIModels } from "../shared/api";

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
        this.model = (configuration.apiModelId as OpenAIModelId) || "gpt-4-0613";

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

        const openaiMessages = this.convertToOpenAIMessages(systemPrompt, messages);
        const openaiTools = this.convertToOpenAITools(tools);

        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: openaiMessages,
            tools: openaiTools,
            tool_choice: "auto",
        });

        const choice = response.choices[0];
        console.log("OpenAI response received");

        return this.convertToAnthropicMessage(response, choice);
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

    private convertToOpenAIMessages(
        systemPrompt: string,
        messages: Anthropic.Messages.MessageParam[]
    ): OpenAI.Chat.ChatCompletionMessageParam[] {
        const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
        ];
    
        for (const msg of messages) {
            if (typeof msg.content === "string") {
                openaiMessages.push({ role: msg.role, content: msg.content });
            } else if (Array.isArray(msg.content)) {
                const content = msg.content.map(item => {
                    if (item.type === "text") {
                        return item.text;
                    }
                    if (item.type === "image") {
                        return `[Image: data:${item.source.media_type};base64,${item.source.data}]`;
                    }
                    if (item.type === "tool_use") {
                        return `[Tool Use: ${item.name}]`;
                    }
                    if (item.type === "tool_result") {
                        return `[Tool Result: ${JSON.stringify(item.content)}]`;
                    }
                    return "";
                }).join("\n");
    
                openaiMessages.push({ role: msg.role, content });
            }
        }
    
        return openaiMessages;
    }

    private convertToOpenAITools(tools: Anthropic.Messages.Tool[]): OpenAI.Chat.ChatCompletionTool[] {
        return tools.map(tool => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
            },
        }));
    }

    private convertToAnthropicMessage(
        response: OpenAI.Chat.Completions.ChatCompletion,
        choice: OpenAI.Chat.Completions.ChatCompletion.Choice
    ): Anthropic.Messages.Message {
        const content: Anthropic.Messages.ContentBlock[] = [];

        if (choice.message?.content) {
            content.push({ type: "text", text: choice.message.content });
        }

        if (choice.message?.tool_calls) {
            for (const toolCall of choice.message.tool_calls) {
                content.push({
                    type: "tool_use",
                    id: toolCall.id,
                    name: toolCall.function.name,
                    input: JSON.parse(toolCall.function.arguments || "{}"),
                } as Anthropic.ToolUseBlock);
            }
        }

        return {
            id: uuidv4(),
            role: "assistant",
            content,
            model: this.model,
            stop_reason: this.mapFinishReason(choice.finish_reason),
            stop_sequence: null,
            type: "message",
            usage: {
                input_tokens: response.usage?.prompt_tokens || 0,
                output_tokens: response.usage?.completion_tokens || 0,
            },
        } as Anthropic.Messages.Message;
    }

    private convertContent(
        content: Array<
            | Anthropic.TextBlockParam
            | Anthropic.ImageBlockParam
            | Anthropic.ToolUseBlockParam
            | Anthropic.ToolResultBlockParam
        >
    ): Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> {
        console.log("Converting content for OpenAI");

        return content.map((item) => {
            switch (item.type) {
                case "text":
                    return { type: "text", text: item.text };
                case "image":
                    return { type: "image_url", image_url: { url: `data:${item.source.media_type};base64,${item.source.data}` } };
                case "tool_use":
                    return { type: "text", text: `[Tool Use: ${item.name}]` };
                case "tool_result":
                    return { type: "text", text: `[Tool Result: ${JSON.stringify(item.content)}]` };
                default:
                    throw new Error(`Unsupported content type: ${(item as any).type}`);
            }
        });
    }

    private mapFinishReason(finishReason: string | null): "tool_use" | "end_turn" | "max_tokens" | "stop_sequence" | null {
        switch (finishReason) {
            case "stop": return "end_turn";
            case "length": return "max_tokens";
            case "tool_calls": return "tool_use";
            case "content_filter": return "stop_sequence";
            default: return null;
        }
    }
}