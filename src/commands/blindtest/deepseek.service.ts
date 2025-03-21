import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Blindtest } from './types';

interface DeepseekResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

@Injectable()
export class DeepseekService {
  private readonly logger = new Logger(DeepseekService.name);
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (!apiKey) {
      throw new Error(
        'DEEPSEEK_API_KEY is not defined in environment variables',
      );
    }
    this.apiKey = apiKey;
  }

  async generateBlindtest(
    prompt: string,
    questionCount: number,
    answerType: string,
  ): Promise<Blindtest> {
    try {
      this.logger.log(
        `Generating blindtest with prompt: ${prompt}, ${questionCount} questions, answer type: ${answerType}`,
      );

      const response = await fetch(
        'https://api.deepseek.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              {
                role: 'system',
                content: `You are a music expert. Generate a music quiz (blindtest) in JSON format with the following schema:
              {
                "theme": string,
                "answerType": string,
                "questions": [
                  {
                    "meta": {
                      "type": string,
                      "source": string,
                      "title": string,
                      "composer": string
                    },
                    "acceptable_answers": string[],
                    "displayableAnswer": string
                  }
                ]
              }
              The theme should match the provided prompt.
              The answerType should match the provided answer type (e.g., "game name", "artist", "song title").
              For each question, provide various acceptable answers that match the answerType.
              The displayableAnswer should be the most obvious/clear answer among the acceptable_answers.
              Do not include YouTube URLs, they will be added later.
              IMPORTANT: Generate exactly ${questionCount} questions.
              IMPORTANT: Return only the JSON, without backticks or code markers.`,
              },
              {
                role: 'user',
                content: `Theme: ${prompt}\nAnswer type: ${answerType}`,
              },
            ],
            temperature: 0.7,
            max_tokens: 1000,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Deepseek API error: ${response.status} ${response.statusText}`,
        );
        this.logger.error(`Response body: ${errorText}`);
        throw new Error(
          `Deepseek API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as DeepseekResponse;
      this.logger.log(
        `Raw response from Deepseek: ${JSON.stringify(data, null, 2)}`,
      );

      const content = data.choices[0].message.content;
      this.logger.log(`Content from Deepseek: ${content}`);

      // Nettoyer le contenu des backticks et marqueurs de code si présents
      const cleanContent = content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      this.logger.log(`Cleaned content: ${cleanContent}`);

      try {
        const blindtest = JSON.parse(cleanContent) as Blindtest;
        this.logger.log(
          `Successfully parsed blindtest: ${JSON.stringify(blindtest, null, 2)}`,
        );
        return blindtest;
      } catch (parseError) {
        this.logger.error(`Error parsing JSON: ${parseError}`);
        this.logger.error(`Content that failed to parse: ${cleanContent}`);
        throw new Error(
          `Invalid JSON response from Deepseek: ${parseError.message}`,
        );
      }
    } catch (error) {
      this.logger.error(`Error generating blindtest: ${error}`);
      throw error;
    }
  }
}
