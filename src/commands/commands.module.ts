import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StreamingService } from './streaming/streaming.service';
import { BlindtestService } from './blindtest/blindtest.service';
import { DeepseekService } from './blindtest/deepseek.service';

@Module({
  imports: [ConfigModule],
  providers: [StreamingService, BlindtestService, DeepseekService],
  exports: [StreamingService, BlindtestService, DeepseekService],
})
export class CommandsModule {}
