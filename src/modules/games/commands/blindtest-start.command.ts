import { SlashCommand, Context, SlashCommandContext } from "necord";
import { Injectable } from "@nestjs/common";
import { BlindtestService } from "../services/blindtest.service";

@Injectable()
export class BlindtestStartCommand {
  constructor(private readonly blindtestService: BlindtestService) {}

  @SlashCommand({
    name: "blindtest-start",
    description: "Démarre le blindtest",
  })
  public async onBlindtestStart(
    @Context() [interaction]: SlashCommandContext
  ): Promise<void> {
    await this.blindtestService.onBlindtestStart([interaction]);
  }
}
