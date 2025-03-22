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
        .setTitle("🎵 File d'attente")
        .setColor("#0099ff");

      // Musique en cours
      const currentSong = queue.items[queue.currentIndex];
      embed.addFields({
        name: "🎶 En cours de lecture",
        value: `**${currentSong.title}**`,
        inline: false,
      });

      // Musiques à venir
      const upcomingSongs = queue.items.slice(queue.currentIndex + 1);
      if (upcomingSongs.length > 0) {
        const upcomingList = upcomingSongs
          .map((item, index) => `${index + 1}. ${item.title}`)
          .join("\n");
        embed.addFields({
          name: "📋 À venir",
          value: upcomingList,
          inline: false,
        });
      }

      // Informations supplémentaires
      embed.setFooter({
        text: `${queue.items.length} musiques au total • ${queue.currentIndex + 1}/${queue.items.length}`,
      });

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
