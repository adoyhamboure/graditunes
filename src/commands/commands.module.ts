import { Module } from '@nestjs/common';
import { PingService } from './ping/ping.service';
import { StreamingService } from './streaming/streaming.service';

@Module({
  providers: [PingService, StreamingService],
})
export class CommandsModule {}
