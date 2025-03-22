import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BLINDTEST_SYSTEM_PROMPT } from "modules/games/constants/blindtestPrompt.constant";
import { Blindtest } from "modules/games/interfaces/blindtest.interface";

interface GPTResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

@Injectable()
export class GPTService {
  private readonly logger = new Logger(GPTService.name);
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not defined in environment variables");
    }
    this.apiKey = apiKey;
  }

  async generateBlindtest(
    prompt: string,
    questionCount: number,
    answerType: string,
    difficulty: string
  ): Promise<Blindtest> {
    this.logger.log(
      `Generating blindtest with prompt: ${prompt}, questionCount: ${questionCount}, answerType: ${answerType}, difficulty: ${difficulty}`
    );

    const userPrompt = `Generate a blindtest with ${questionCount} questions about ${prompt}. The answers should be of type: ${answerType}. The difficulty should be: ${difficulty}.`;

    try {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: BLINDTEST_SYSTEM_PROMPT,
              },
              {
                role: "user",
                content: userPrompt,
              },
            ],
            temperature: 0.7,
            max_tokens: 2000,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `OpenAI API error: ${response.status} ${response.statusText}`
        );
        this.logger.error(`Response body: ${errorText}`);
        throw new Error(
          `OpenAI API error: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as GPTResponse;
      this.logger.log(
        `Raw response from OpenAI: ${JSON.stringify(data, null, 2)}`
      );

      const content = data.choices[0].message.content;
      this.logger.log(`OpenAI response: ${content}`);

      if (!content) {
        throw new Error("No content in OpenAI response");
      }

      // Nettoyer le contenu des marqueurs de code Markdown
      const cleanContent = content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      this.logger.log(`Cleaned content: ${cleanContent}`);

      try {
        const blindtest = JSON.parse(cleanContent) as Blindtest;
        this.logger.log(
          `Successfully parsed blindtest: ${JSON.stringify(blindtest, null, 2)}`
        );
        return blindtest;
      } catch (parseError: unknown) {
        const errorMessage =
          parseError instanceof Error ? parseError.message : String(parseError);
        this.logger.error(`Error parsing JSON: ${errorMessage}`);
        this.logger.error(`Content that failed to parse: ${cleanContent}`);
        throw new Error(`Invalid JSON response from OpenAI: ${errorMessage}`);
      }
    } catch (error) {
      this.logger.error(`Error generating blindtest: ${error}`);
      throw error;
    }
  }
}
