import { Injectable } from "@nestjs/common";
import { Context, SlashCommand, SlashCommandContext } from "necord";
import { MusicService } from "../services/music.service";
import { GuildMember } from "discord.js";

@Injectable()
export class StopCommand {
  constructor(private readonly musicService: MusicService) {}

  @SlashCommand({
    name: "stop",
    description: "Arrête la musique et quitte le salon vocal",
  })
  public async onStop(@Context() [interaction]: SlashCommandContext) {
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
      const player = this.musicService.getPlayer(interaction.guildId!);
      const connection = this.musicService.getConnection(interaction.guildId!);

      if (!player && !connection) {
        await interaction.editReply({
          content: "Je ne suis pas dans un salon vocal !",
        });
        return;
      }

      if (player) {
        this.musicService.clearQueue(interaction.guildId!);
        player.stop();
      }

      if (connection) {
        connection.destroy();
      }

      await interaction.editReply({
        content: "Bot déconnecté du salon vocal !",
      });
    } catch (error) {
      await interaction.editReply({
        content: `Une erreur est survenue : ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      });
    }
  }
}
