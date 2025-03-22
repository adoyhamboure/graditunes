import { Module } from "@nestjs/common";
import { DeepseekService } from "./services/deepseek.service";
import { GPTService } from "./services/gpt.service";
import { AIService } from "./services/ai.service";
import { AskGPTCommand } from "./commands/askgpt.command";
import { AskDeepseekCommand } from "./commands/askds.command";

@Module({
  imports: [],
  controllers: [],
  providers: [
    DeepseekService,
    GPTService,
    AIService,
    AskGPTCommand,
    AskDeepseekCommand,
  ],
  exports: [DeepseekService, GPTService, AIService],
})
export class AiModule {}
