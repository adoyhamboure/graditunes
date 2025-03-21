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
    difficulty: string,
  ): Promise<Blindtest> {
    this.logger.log(
      `Generating blindtest with prompt: ${prompt}, questionCount: ${questionCount}, answerType: ${answerType}, difficulty: ${difficulty}`,
    );

    const systemPrompt = `You are a music expert and blindtest question generator. Your task is to create a JSON object that matches the following schema:

{
  "theme": "string - The main theme of the blindtest (e.g., 'musique pop des années 80', 'rap français', 'musique de jeux vidéo', 'jazz classique')",
  "answerType": "string - The type of answer expected (e.g., 'nom du jeu', 'artiste', 'titre de la musique', 'nom du groupe')",
  "questions": [
    {
      "meta": {
        "type": "string - The type of media (e.g., 'game', 'movie', 'anime', 'album', 'single', 'concert')",
        "source": "string - The source of the media (e.g., 'Final Fantasy VII', 'The Beatles', 'Michael Jackson', 'Daft Punk')",
        "title": "string - The title of the specific piece (e.g., 'Aerith's Theme', 'Billie Jean', 'Get Lucky')",
        "composer": "string - The composer, artist, or band of the piece"
      },
      "acceptable_answers": ["array of strings - All possible correct answers"],
      "displayableAnswer": "string - The answer to display when the question is solved"
    }
  ]
}

Important rules:
1. DO NOT include any URLs in the response
2. The 'title' field should contain the specific piece title, not the album or artist name
3. The 'source' field should contain the album, artist, game, movie, or other source name
4. The 'displayableAnswer' should be the most common or official name of the piece
5. Include multiple acceptable answers in 'acceptable_answers' to account for variations
6. Make sure the difficulty matches the requested level (${difficulty})
7. The answerType should match the requested type (${answerType})
8. Adapt the questions to the requested theme, whether it's video game music, pop, rap, classical, or any other genre
9. For traditional music (pop, rap, etc.), use 'album' or 'single' as the type and the artist/band name as the source
10. For video game music, use 'game' as the type and the game name as the source
11. For movie music, use 'movie' as the type and the movie name as the source

JSON Format Rules:
1. Return ONLY the raw JSON object, without any markdown code blocks (\`\`\`json or \`\`\`)
2. Do not include any explanatory text before or after the JSON
3. Ensure all strings are properly escaped
4. Make sure all arrays and objects are properly closed
5. The JSON must be valid and parseable

Examples of correct structure:
1. For a video game music:
   {
     "meta": {
       "type": "game",
       "source": "Final Fantasy VII",
       "title": "Aerith's Theme",
       "composer": "Nobuo Uematsu"
     },
     "acceptable_answers": ["Final Fantasy VII", "FF7", "FFVII"],
     "displayableAnswer": "Final Fantasy VII"
   }

2. For a pop song:
   {
     "meta": {
       "type": "single",
       "source": "Michael Jackson",
       "title": "Billie Jean",
       "composer": "Michael Jackson"
     },
     "acceptable_answers": ["Billie Jean", "Billy Jean"],
     "displayableAnswer": "Billie Jean"
   }

3. For a movie soundtrack:
   {
     "meta": {
       "type": "movie",
       "source": "Star Wars: Episode IV",
       "title": "Imperial March",
       "composer": "John Williams"
     },
     "acceptable_answers": ["Star Wars", "Star Wars Episode IV", "A New Hope"],
     "displayableAnswer": "Star Wars: Episode IV - A New Hope"
   }

IMPORTANT: Always follow this structure exactly. The 'title' field must contain the specific piece title, not the game/movie/album name. The 'source' field must contain the game/movie/album/artist name. Return ONLY the raw JSON object without any markdown formatting.`;

    const userPrompt = `Generate a blindtest with ${questionCount} questions about ${prompt}. The answers should be of type: ${answerType}. The difficulty should be: ${difficulty}.`;

    try {
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
                content: systemPrompt,
              },
              {
                role: 'user',
                content: userPrompt,
              },
            ],
            temperature: 0.7,
            max_tokens: 2000,
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
      this.logger.log(`Deepseek response: ${content}`);

      if (!content) {
        throw new Error('No content in Deepseek response');
      }

      // Nettoyer le contenu des marqueurs de code Markdown
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
      } catch (parseError: unknown) {
        const errorMessage =
          parseError instanceof Error ? parseError.message : String(parseError);
        this.logger.error(`Error parsing JSON: ${errorMessage}`);
        this.logger.error(`Content that failed to parse: ${cleanContent}`);
        throw new Error(`Invalid JSON response from Deepseek: ${errorMessage}`);
      }
    } catch (error) {
      this.logger.error(`Error generating blindtest: ${error}`);
      throw error;
    }
  }
}
