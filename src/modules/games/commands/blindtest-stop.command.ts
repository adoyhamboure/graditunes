import { SlashCommand, Context, SlashCommandContext } from "necord";
import { Injectable } from "@nestjs/common";
import { BlindtestService } from "../services/blindtest.service";

@Injectable()
export class BlindtestStopCommand {
  constructor(private readonly blindtestService: BlindtestService) {}

  @SlashCommand({
    name: "blindtest-stop",
    description: "Arrête le blindtest en cours et affiche les scores",
  })
  public async onBlindtestStop(
    @Context() [interaction]: SlashCommandContext
  ): Promise<void> {
    await this.blindtestService.onBlindtestStop([interaction]);
  }
}
