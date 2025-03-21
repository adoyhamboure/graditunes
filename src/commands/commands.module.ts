import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StreamingService } from './streaming/streaming.service';
import { BlindtestService } from './blindtest/blindtest.service';
import { DeepseekService } from './blindtest/deepseek.service';
import { GPTService } from './blindtest/gpt.service';

@Module({
  imports: [ConfigModule],
  providers: [StreamingService, BlindtestService, DeepseekService, GPTService],
  exports: [StreamingService, BlindtestService, DeepseekService, GPTService],
})
export class CommandsModule {}
