import { Injectable, Logger } from '@nestjs/common';
import {
  Context,
  SlashCommand,
  SlashCommandContext,
  Options,
  StringOption,
} from 'necord';
import { ConfigService } from '@nestjs/config';

interface AIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

class AskDto {
  @StringOption({
    name: 'prompt',
    description: "Votre question pour l'IA",
    required: true,
  })
  prompt: string;
}

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private readonly gptApiKey: string;
  private readonly deepseekApiKey: string;

  constructor(private readonly configService: ConfigService) {
    const gptApiKey = this.configService.get<string>('OPENAI_API_KEY');
    const deepseekApiKey = this.configService.get<string>('DEEPSEEK_API_KEY');

    if (!gptApiKey) {
      throw new Error('OPENAI_API_KEY is not defined in environment variables');
    }
    if (!deepseekApiKey) {
      throw new Error(
        'DEEPSEEK_API_KEY is not defined in environment variables',
      );
    }

    this.gptApiKey = gptApiKey;
    this.deepseekApiKey = deepseekApiKey;
  }

  @SlashCommand({
    name: 'askgpt',
    description: 'Posez une question à GPT-4',
  })
  public async onAskGPT(
    @Context() [interaction]: SlashCommandContext,
    @Options() { prompt }: AskDto,
  ): Promise<void> {
    await interaction.deferReply();

    try {
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.gptApiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.7,
            max_tokens: 2000,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `OpenAI API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as AIResponse;
      const content = data.choices[0].message.content;

      await interaction.editReply({
        content: `**Question:** ${prompt}\n\n**Réponse de GPT-4:**\n${content}`,
      });
    } catch (error) {
      this.logger.error(`Error in askgpt command: ${error}`);
      await interaction.editReply({
        content: `Une erreur est survenue: ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
      });
    }
  }

  @SlashCommand({
    name: 'askds',
    description: 'Posez une question à Deepseek',
  })
  public async onAskDeepseek(
    @Context() [interaction]: SlashCommandContext,
    @Options() { prompt }: AskDto,
  ): Promise<void> {
    await interaction.deferReply();

    try {
      const response = await fetch(
        'https://api.deepseek.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.deepseekApiKey}`,
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.7,
            max_tokens: 2000,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Deepseek API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as AIResponse;
      const content = data.choices[0].message.content;

      await interaction.editReply({
        content: `**Question:** ${prompt}\n\n**Réponse de Deepseek:**\n${content}`,
      });
    } catch (error) {
      this.logger.error(`Error in askds command: ${error}`);
      await interaction.editReply({
        content: `Une erreur est survenue: ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
      });
    }
  }
}
