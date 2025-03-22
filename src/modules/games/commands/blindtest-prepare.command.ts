import { SlashCommand, Context, SlashCommandContext } from "necord";
import { Injectable } from "@nestjs/common";
import { BlindtestService } from "../services/blindtest.service";

@Injectable()
export class BlindtestPrepareCommand {
  constructor(private readonly blindtestService: BlindtestService) {}

  @SlashCommand({
    name: "blindtest-prepare",
    description: "Prépare un blindtest avec un thème spécifique",
  })
  public async onBlindtestPrepare(
    @Context() [interaction]: SlashCommandContext
  ): Promise<void> {
    await this.blindtestService.onBlindtestPrepare([interaction]);
  }
}
