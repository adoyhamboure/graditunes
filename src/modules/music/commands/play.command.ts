import { Injectable } from "@nestjs/common";
import { Context, SlashCommand, SlashCommandContext, Options } from "necord";
import { PlayDto } from "../dtos/play.dto";
import { MusicService } from "../services/music.service";
import { GuildMember } from "discord.js";

@Injectable()
export class PlayCommand {
  constructor(private readonly musicService: MusicService) {}

  @SlashCommand({
    name: "play",
    description:
      "Joue de la musique à partir d'une URL YouTube ou d'une recherche",
  })
  public async onPlay(
    @Context() [interaction]: SlashCommandContext,
    @Options() { url }: PlayDto
  ) {
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
      await this.musicService.playMusic(
        interaction.guildId!,
        voiceChannel.id,
        interaction.channelId,
        url,
        interaction
      );
    } catch (error) {
      await interaction.editReply({
        content: `Une erreur est survenue : ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      });
    }
  }
}
