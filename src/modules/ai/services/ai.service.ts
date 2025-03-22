import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class AIService {
  private readonly gptApiKey: string;
  private readonly deepseekApiKey: string;

  constructor(private readonly configService: ConfigService) {
    const gptApiKey = this.configService.get<string>("OPENAI_API_KEY");
    const deepseekApiKey = this.configService.get<string>("DEEPSEEK_API_KEY");

    if (!gptApiKey) {
      throw new Error("OPENAI_API_KEY is not defined in environment variables");
    }
    if (!deepseekApiKey) {
      throw new Error(
        "DEEPSEEK_API_KEY is not defined in environment variables"
      );
    }

    this.gptApiKey = gptApiKey;
    this.deepseekApiKey = deepseekApiKey;
  }

  public getGPTApiKey(): string {
    return this.gptApiKey;
  }

  public getDeepseekApiKey(): string {
    return this.deepseekApiKey;
  }
}
