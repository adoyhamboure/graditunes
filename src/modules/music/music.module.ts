import { Module, forwardRef } from '@nestjs/common';
import { MusicService } from './services/music.service';
import { GamesModule } from '../games/games.module';
import { PlayCommand } from './commands/play.command';
import { SkipCommand } from './commands/skip.command';
import { StopCommand } from './commands/stop.command';
import { QueueCommand } from './commands/queue.command';
import { ClearCommand } from './commands/clear.command';

@Module({
  imports: [forwardRef(() => GamesModule)],
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
