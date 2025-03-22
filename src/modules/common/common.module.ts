import { Module } from "@nestjs/common";
import { PingCommand } from "./commands/ping.command";

@Module({
  imports: [],
  controllers: [],
  providers: [PingCommand],
})
export class CommonModule {}
