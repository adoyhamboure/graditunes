import { Module } from '@nestjs/common';
import { StreamingService } from './streaming/streaming.service';
import { BlindtestService } from './blindtest/blindtest.service';

@Module({
  providers: [StreamingService, BlindtestService],
  exports: [StreamingService, BlindtestService],
})
export class CommandsModule {}
