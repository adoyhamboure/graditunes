import { Injectable } from "@nestjs/common";
import { Context, SlashCommand, SlashCommandContext } from "necord";
import { MusicService } from "../services/music.service";
import { EmbedBuilder } from "discord.js";

@Injectable()
export class QueueCommand {
  constructor(private readonly musicService: MusicService) {}

  @SlashCommand({
    name: "queue",
    description: "Affiche la file d'attente des musiques",
  })
  public async onQueue(@Context() [interaction]: SlashCommandContext) {
    await interaction.deferReply();

    try {
      const queue = this.musicService.getQueue(interaction.guildId!);
      if (!queue || queue.items.length === 0) {
        await interaction.editReply({
          content: "La file d'attente est vide !",
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("File d'attente")
        .setColor("#0099ff");

      const queueList = queue.items
        .map((item, index) => `${index + 1}. ${item.title}`)
        .join("\n");

      embed.setDescription(queueList);

      await interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      await interaction.editReply({
        content: `Une erreur est survenue : ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      });
    }
  }
}
