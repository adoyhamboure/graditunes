import { Injectable } from "@nestjs/common";
import { Context, SlashCommand, SlashCommandContext } from "necord";
import { MusicService } from "../services/music.service";
import { GuildMember } from "discord.js";

@Injectable()
export class ClearCommand {
  constructor(private readonly musicService: MusicService) {}

  @SlashCommand({
    name: "clear",
    description: "Vide la file d'attente des musiques",
  })
  public async onClear(@Context() [interaction]: SlashCommandContext) {
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
          content: "La file d'attente est déjà vide !",
        });
        return;
      }

      this.musicService.clearQueue(interaction.guildId!);
      await interaction.editReply({
        content: "La file d'attente a été vidée !",
      });
    } catch (error) {
      await interaction.editReply({
        content: `Une erreur est survenue : ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      });
    }
  }
}
