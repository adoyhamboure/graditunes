import { Injectable } from "@nestjs/common";
import { Context, SlashCommand, SlashCommandContext } from "necord";
import { MusicService } from "../services/music.service";
import { GuildMember } from "discord.js";

@Injectable()
export class SkipCommand {
  constructor(private readonly musicService: MusicService) {}

  @SlashCommand({
    name: "skip",
    description: "Passe à la musique suivante dans la file d'attente",
  })
  public async onSkip(@Context() [interaction]: SlashCommandContext) {
    if (!(interaction.member instanceof GuildMember)) {
      return;
    }

    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      await interaction.reply({
        content:
          "Tu dois être dans un salon vocal pour utiliser cette commande !",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    try {
      const queue = this.musicService.getQueue(interaction.guildId!);
      if (!queue || queue.items.length === 0) {
        await interaction.editReply({
          content: "Il n'y a pas de musique dans la file d'attente !",
        });
        return;
      }

      const player = this.musicService.getPlayer(interaction.guildId!);
      if (!player) {
        await interaction.editReply({
          content: "Aucune musique n'est en cours de lecture !",
        });
        return;
      }

      player.stop();
      await interaction.editReply({
        content: "Musique suivante !",
      });
    } catch (error) {
      await interaction.editReply({
        content: `Une erreur est survenue : ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      });
    }
  }
}
