import { Injectable } from "@nestjs/common";
import { Context, SlashCommand, SlashCommandContext } from "necord";

@Injectable()
export class PingCommand {
  @SlashCommand({
    name: "ping",
    description: "Responds with pong!",
  })
  public async onPing(@Context() [interaction]: SlashCommandContext) {
    return interaction.reply({ content: "Pong!" });
  }
}
