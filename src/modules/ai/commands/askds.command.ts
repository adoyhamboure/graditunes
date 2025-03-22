import { Injectable, Logger } from "@nestjs/common";
import { Context, SlashCommand, SlashCommandContext, Options } from "necord";
import { ConfigService } from "@nestjs/config";
import { AskDto } from "../dtos/ask.dto";
import { AIResponse } from "../interfaces/aiResponse.interface";

@Injectable()
export class AskDeepseekCommand {
  private readonly logger = new Logger(AskDeepseekCommand.name);
  private readonly deepseekApiKey: string;

  constructor(private readonly configService: ConfigService) {
    const deepseekApiKey = this.configService.get<string>("DEEPSEEK_API_KEY");

    if (!deepseekApiKey) {
      throw new Error(
        "DEEPSEEK_API_KEY is not defined in environment variables"
      );
    }

    this.deepseekApiKey = deepseekApiKey;
  }

  @SlashCommand({
    name: "askds",
    description: "Posez une question à Deepseek",
  })
  public async execute(
    @Context() [interaction]: SlashCommandContext,
    @Options() { prompt }: AskDto
  ): Promise<void> {
    await interaction.deferReply();

    try {
      const response = await fetch(
        "https://api.deepseek.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.deepseekApiKey}`,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
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
          `Deepseek API error: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as AIResponse;
      const content = data.choices[0].message.content;

      await interaction.editReply({
        content: `**Question:** ${prompt}\n\n**Réponse de Deepseek:**\n${content}`,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Erreur inconnue";
      this.logger.error(`Error in askds command: ${errorMessage}`);
      await interaction.editReply({
        content: `Une erreur est survenue: ${errorMessage}`,
      });
    }
  }
}
