import { Module } from "@nestjs/common";
import { BlindtestService } from "./services/blindtest.service";
import { MusicModule } from "../music/music.module";
import { AiModule } from "../ai/ai.module";
import { BlindtestPrepareCommand } from "./commands/blindtest-prepare.command";
import { BlindtestStartCommand } from "./commands/blindtest-start.command";
import { BlindtestStopCommand } from "./commands/blindtest-stop.command";

@Module({
  imports: [AiModule, MusicModule],
  controllers: [],
  providers: [
    BlindtestService,
    BlindtestPrepareCommand,
    BlindtestStartCommand,
    BlindtestStopCommand,
  ],
  exports: [BlindtestService],
})
export class GamesModule {}
