import { Module } from "@nestjs/common";
import { MusicService } from "./services/music.service";
import { PlayCommand } from "./commands/play.command";
import { SkipCommand } from "./commands/skip.command";
import { StopCommand } from "./commands/stop.command";
import { QueueCommand } from "./commands/queue.command";
import { ClearCommand } from "./commands/clear.command";

@Module({
  imports: [],
  controllers: [],
  providers: [
    MusicService,
    PlayCommand,
    SkipCommand,
    StopCommand,
    QueueCommand,
    ClearCommand,
  ],
  exports: [MusicService],
})
export class MusicModule {}
