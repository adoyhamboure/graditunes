import { Injectable, Logger } from "@nestjs/common";
import { Context, SlashCommand, SlashCommandContext, Options } from "necord";
import { ConfigService } from "@nestjs/config";
import { AskDto } from "../dtos/ask.dto";
import { AIResponse } from "../interfaces/aiResponse.interface";

@Injectable()
export class AskGPTCommand {
  private readonly logger = new Logger(AskGPTCommand.name);
  private readonly gptApiKey: string;

  constructor(private readonly configService: ConfigService) {
    const gptApiKey = this.configService.get<string>("OPENAI_API_KEY");

    if (!gptApiKey) {
      throw new Error("OPENAI_API_KEY is not defined in environment variables");
    }

    this.gptApiKey = gptApiKey;
  }

  @SlashCommand({
    name: "askgpt",
    description: "Posez une question à GPT-4",
  })
  public async execute(
    @Context() [interaction]: SlashCommandContext,
    @Options() { prompt }: AskDto
  ): Promise<void> {
    await interaction.deferReply();

    try {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.gptApiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "user",
                content: prompt,
              },
            ],
            temperature: 0.7,
            max_tokens: 2000,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `OpenAI API error: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as AIResponse;
      const content = data.choices[0].message.content;

      await interaction.editReply({
        content: `**Question:** ${prompt}\n\n**Réponse de GPT-4:**\n${content}`,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Erreur inconnue";
      this.logger.error(`Error in askgpt command: ${errorMessage}`);
      await interaction.editReply({
        content: `Une erreur est survenue: ${errorMessage}`,
      });
    }
  }
}
