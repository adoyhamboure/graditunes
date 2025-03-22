import { Injectable, Logger } from "@nestjs/common";
import { Context, On, Once, ContextOf } from "necord";
import { BlindtestService } from "./modules/games/services/blindtest.service";

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(private readonly blindtestService: BlindtestService) {}

  @Once("ready")
  public onReady(@Context() [client]: ContextOf<"ready">) {
    this.logger.log(`Bot logged in as ${client.user.username}`);
  }

  @On("warn")
  public onWarn(@Context() [message]: ContextOf<"warn">) {
    this.logger.warn(message);
  }

  @On("interactionCreate")
  public async onInteractionCreate(
    @Context() [interaction]: ContextOf<"interactionCreate">
  ) {
    if (
      interaction.isModalSubmit() &&
      interaction.customId === "answer_modal"
    ) {
      await this.blindtestService.handleAnswerModal(interaction);
    } else if (
      interaction.isModalSubmit() &&
      interaction.customId === "blindtest_prepare_modal"
    ) {
      await this.blindtestService.handleBlindtestPrepareModal(interaction);
    }
  }
}
