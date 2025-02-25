import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SlashCommand, Context, SlashCommandContext, Options } from 'necord';
import { PlayDto } from './play.dto';
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  StreamType,
} from '@discordjs/voice';
import { GuildMember } from 'discord.js';
import * as ytdl from '@distube/ytdl-core';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StreamingService implements OnModuleInit {
  private readonly logger = new Logger(StreamingService.name);
  private connections = new Map();
  private players = new Map();
  private agent: any;

  constructor(private readonly configService: ConfigService) {}

  public async onModuleInit() {
    this.logger.log('StreamingService has been initialized!');
    this.agent = ytdl.createAgent(this.buildYoutubeCookies());
  }

  private buildYoutubeCookies() {
    return [
      {
        name: 'SID',
        value: this.configService.get('YT_SID'),
        domain: '.youtube.com',
      },
      {
        name: 'HSID',
        value: this.configService.get('YT_HSID'),
        domain: '.youtube.com',
      },
      {
        name: 'SSID',
        value: this.configService.get('YT_SSID'),
        domain: '.youtube.com',
      },
      {
        name: 'APISID',
        value: this.configService.get('YT_APISID'),
        domain: '.youtube.com',
      },
      {
        name: 'SAPISID',
        value: this.configService.get('YT_SAPISID'),
        domain: '.youtube.com',
      },
      {
        name: '__Secure-1PSID',
        value: this.configService.get('YT_1PSID'),
        domain: '.youtube.com',
      },
      {
        name: '__Secure-1PAPISID',
        value: this.configService.get('YT_1PAPISID'),
        domain: '.youtube.com',
      },
      {
        name: '__Secure-3PSID',
        value: this.configService.get('YT_3PSID'),
        domain: '.youtube.com',
      },
      {
        name: '__Secure-3PAPISID',
        value: this.configService.get('YT_3PAPISID'),
        domain: '.youtube.com',
      },
      {
        name: 'LOGIN_INFO',
        value: this.configService.get('YT_LOGIN_INFO'),
        domain: '.youtube.com',
      },
      {
        name: 'VISITOR_INFO1_LIVE',
        value: this.configService.get('YT_VISITOR_INFO'),
        domain: '.youtube.com',
      },
      {
        name: 'PREF',
        value: this.configService.get('YT_PREF'),
        domain: '.youtube.com',
      },
      {
        name: '__Secure-YEC',
        value: this.configService.get('YT_SECURE_YEC'),
        domain: '.youtube.com',
      },
    ];
  }

  @SlashCommand({
    name: 'play',
    description: 'Plays a song from YouTube',
  })
  public async onPlay(
    @Context() [interaction]: SlashCommandContext,
    @Options() { url }: PlayDto,
  ) {
    if (!interaction.guild) {
      return interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      const member = interaction.member as GuildMember;
      const voiceChannel = member.voice.channel;

      if (!voiceChannel) {
        return interaction.editReply(
          'You must be in a voice channel to use this command!',
        );
      }

      // Validate URL
      if (!ytdl.validateURL(url)) {
        return interaction.editReply('Please provide a valid YouTube URL.');
      }

      // Get video info
      const videoInfo = await ytdl.getBasicInfo(url, { agent: this.agent });
      const songTitle = videoInfo.videoDetails.title;

      // Gérer la connexion existante
      let connection = this.connections.get(interaction.guildId);
      if (connection) {
        if (connection.state.status === VoiceConnectionStatus.Destroyed) {
          this.connections.delete(interaction.guildId);
          connection = null;
        }
      }

      // Créer une nouvelle connexion
      if (!connection) {
        connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guildId as string,
          adapterCreator: interaction.guild.voiceAdapterCreator,
          selfDeaf: true,
          selfMute: false,
        });
        this.connections.set(interaction.guildId, connection);
      }

      // Créer le lecteur
      let player = this.players.get(interaction.guildId);
      if (!player) {
        player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Play,
          },
        });
        this.players.set(interaction.guildId, player);
      }

      // Attendre que la connexion soit prête
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      } catch (error) {
        this.logger.error('Connection failed to become ready');
        throw new Error('Failed to join voice channel');
      }

      // S'abonner au lecteur
      const subscription = connection.subscribe(player);
      if (!subscription) {
        throw new Error('Failed to subscribe to the player');
      }

      // Créer le stream
      const stream = ytdl(url, {
        filter: 'audioonly',
        quality: 'highestaudio',
        highWaterMark: 1 << 25,
        agent: this.agent,
      });

      const resource = createAudioResource(stream, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true,
      });

      if (resource.volume) {
        resource.volume.setVolume(0.5);
      }

      // Ajouter des écouteurs d'événements
      player.on(AudioPlayerStatus.Playing, () => {
        this.logger.log(`Now playing: ${songTitle}`);
      });

      player.on(AudioPlayerStatus.Idle, () => {
        this.logger.log('Player is idle');
      });

      player.on('error', (error) => {
        this.logger.error(`Player error: ${error.message}`);
      });

      // Jouer la ressource
      player.play(resource);

      // Attendre que la lecture commence
      try {
        await entersState(player, AudioPlayerStatus.Playing, 10_000);
        this.logger.log('Playback started successfully');
        return interaction.editReply(`🎵 Now playing: **${songTitle}**`);
      } catch (error) {
        this.logger.error('Failed to start playback');
        subscription.unsubscribe();
        throw new Error('Failed to start playback');
      }
    } catch (error) {
      this.logger.error(`Error playing music: ${error.message}`);
      return interaction.editReply(`Une erreur est survenue: ${error.message}`);
    }
  }

  @SlashCommand({
    name: 'stop',
    description: 'Stops playback and leaves the voice channel',
  })
  public async onStop(@Context() [interaction]: SlashCommandContext) {
    if (!interaction.guild) {
      return interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
    }

    const connection = this.connections.get(interaction.guildId);
    const player = this.players.get(interaction.guildId);

    if (!connection) {
      return interaction.reply("I'm not connected to a voice channel!");
    }

    if (player) {
      player.stop();
      this.players.delete(interaction.guildId);
    }

    connection.destroy();
    this.connections.delete(interaction.guildId);

    return interaction.reply('Playback stopped and voice channel left.');
  }
}
