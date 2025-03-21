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
  AudioPlayer,
  VoiceConnection,
} from '@discordjs/voice';
import { GuildMember, EmbedBuilder, TextChannel } from 'discord.js';
import * as ytdl from '@distube/ytdl-core';
import { ConfigService } from '@nestjs/config';
import { GuildQueue, QueueItem } from './types';

interface Cookie {
  name: string;
  value: string;
  domain: string;
}

@Injectable()
export class StreamingService implements OnModuleInit {
  private readonly logger = new Logger(StreamingService.name);
  private connections = new Map<string, VoiceConnection>();
  private players = new Map<string, AudioPlayer>();
  private queues = new Map<string, GuildQueue>();
  private textChannels = new Map<string, TextChannel>();
  private agent: ytdl.Agent;

  constructor(private readonly configService: ConfigService) {}

  public onModuleInit(): void {
    this.logger.log('StreamingService has been initialized!');
    this.agent = ytdl.createAgent(this.buildYoutubeCookies());
  }

  private buildYoutubeCookies(): Cookie[] {
    return [
      {
        name: 'SID',
        value: this.configService.get<string>('YT_SID') || '',
        domain: '.youtube.com',
      },
      {
        name: 'HSID',
        value: this.configService.get<string>('YT_HSID') || '',
        domain: '.youtube.com',
      },
      {
        name: 'SSID',
        value: this.configService.get<string>('YT_SSID') || '',
        domain: '.youtube.com',
      },
      {
        name: 'APISID',
        value: this.configService.get<string>('YT_APISID') || '',
        domain: '.youtube.com',
      },
      {
        name: 'SAPISID',
        value: this.configService.get<string>('YT_SAPISID') || '',
        domain: '.youtube.com',
      },
      {
        name: '__Secure-1PSID',
        value: this.configService.get<string>('YT_1PSID') || '',
        domain: '.youtube.com',
      },
      {
        name: '__Secure-1PAPISID',
        value: this.configService.get<string>('YT_1PAPISID') || '',
        domain: '.youtube.com',
      },
      {
        name: '__Secure-3PSID',
        value: this.configService.get<string>('YT_3PSID') || '',
        domain: '.youtube.com',
      },
      {
        name: '__Secure-3PAPISID',
        value: this.configService.get<string>('YT_3PAPISID') || '',
        domain: '.youtube.com',
      },
      {
        name: 'LOGIN_INFO',
        value: this.configService.get<string>('YT_LOGIN_INFO') || '',
        domain: '.youtube.com',
      },
      {
        name: 'VISITOR_INFO1_LIVE',
        value: this.configService.get<string>('YT_VISITOR_INFO') || '',
        domain: '.youtube.com',
      },
      {
        name: 'PREF',
        value: this.configService.get<string>('YT_PREF') || '',
        domain: '.youtube.com',
      },
      {
        name: '__Secure-YEC',
        value: this.configService.get<string>('YT_SECURE_YEC') || '',
        domain: '.youtube.com',
      },
    ];
  }

  private async createQueueItem(url: string): Promise<QueueItem> {
    const videoInfo = await ytdl.getBasicInfo(url, { agent: this.agent });
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

    return {
      title: videoInfo.videoDetails.title,
      url,
      resource,
    };
  }

  private async createPlayer(guildId: string): Promise<AudioPlayer> {
    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    // Add event listeners only once when creating the player
    player.on(AudioPlayerStatus.Idle, () => {
      this.logger.log('Player is idle');
      const queue = this.queues.get(guildId);
      if (queue) {
        queue.currentIndex++;
        void this.playNext(guildId);
      }
    });

    player.on('error', (error: Error) => {
      this.logger.error(`Player error: ${error.message}`);
    });

    this.players.set(guildId, player);
    return player;
  }

  private async playNext(guildId: string): Promise<void> {
    const queue = this.queues.get(guildId);
    const player = this.players.get(guildId);

    if (!queue || !player) return;

    if (queue.currentIndex >= queue.items.length) {
      queue.currentIndex = 0;
      this.queues.delete(guildId);
      const textChannel = this.textChannels.get(guildId);
      if (textChannel) {
        await textChannel.send("🎵 La file d'attente est terminée !");
      }
      return;
    }

    const currentItem = queue.items[queue.currentIndex];
    player.play(currentItem.resource);

    try {
      await entersState(player, AudioPlayerStatus.Playing, 10_000);
      this.logger.log(`Now playing: ${currentItem.title}`);

      // Afficher un message dans le canal de texte
      const textChannel = this.textChannels.get(guildId);
      if (textChannel) {
        await textChannel.send(
          `🎵 En cours de lecture: **${currentItem.title}**`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to start playback');
      throw error;
    }
  }

  @SlashCommand({
    name: 'play',
    description: 'Plays a song from YouTube',
  })
  public async onPlay(
    @Context() [interaction]: SlashCommandContext,
    @Options() { url }: PlayDto,
  ): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    try {
      const member = interaction.member as GuildMember;
      const voiceChannel = member.voice.channel;

      if (!voiceChannel) {
        await interaction.editReply(
          'You must be in a voice channel to use this command!',
        );
        return;
      }

      // Store the text channel for future messages
      if (interaction.guildId) {
        this.textChannels.set(
          interaction.guildId,
          interaction.channel as TextChannel,
        );
      }

      // Validate URL
      if (!ytdl.validateURL(url)) {
        await interaction.editReply('Please provide a valid YouTube URL.');
        return;
      }

      // Get video info
      const videoInfo = await ytdl.getBasicInfo(url, { agent: this.agent });
      const songTitle = videoInfo.videoDetails.title;

      // Handle existing connection
      let connection = this.connections.get(interaction.guildId || '');
      if (connection) {
        if (connection.state.status === VoiceConnectionStatus.Destroyed) {
          this.connections.delete(interaction.guildId || '');
          connection = undefined;
        }
      }

      // Create new connection
      if (!connection) {
        if (!interaction.guildId) {
          throw new Error('Guild ID is required');
        }
        connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guildId,
          adapterCreator: interaction.guild.voiceAdapterCreator,
          selfDeaf: true,
          selfMute: false,
        });
        this.connections.set(interaction.guildId, connection);
      }

      // Create or get player
      let player = this.players.get(interaction.guildId || '');
      if (!player) {
        player = await this.createPlayer(interaction.guildId || '');
      }

      // Wait for connection to be ready
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      } catch {
        this.logger.error('Connection failed to become ready');
        throw new Error('Failed to join voice channel');
      }

      // Subscribe to player
      const subscription = connection.subscribe(player);
      if (!subscription) {
        throw new Error('Failed to subscribe to the player');
      }

      // Create queue item
      const queueItem = await this.createQueueItem(url);

      // Initialize or get queue
      let queue = this.queues.get(interaction.guildId || '');
      if (!queue) {
        queue = {
          items: [],
          currentIndex: 0,
        };
        if (interaction.guildId) {
          this.queues.set(interaction.guildId, queue);
        }
      }

      // Add to queue
      queue.items.push(queueItem);

      // If this is the first item or no music is currently playing, start playing
      if (
        queue.items.length === 1 ||
        player.state.status === AudioPlayerStatus.Idle
      ) {
        await this.playNext(interaction.guildId || '');
        await interaction.editReply(`🎵 Now playing: **${songTitle}**`);
      } else {
        await interaction.editReply(`🎵 Added to queue: **${songTitle}**`);
      }
    } catch (error) {
      this.logger.error(
        `Error playing music: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      await interaction.editReply(
        `An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  @SlashCommand({
    name: 'skip',
    description: 'Skip the current song and play the next one in the queue',
  })
  public async onSkip(
    @Context() [interaction]: SlashCommandContext,
  ): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const queue = this.queues.get(interaction.guildId || '');
    const player = this.players.get(interaction.guildId || '');

    if (!queue || !player) {
      await interaction.reply('There is no music playing!');
      return;
    }

    try {
      queue.currentIndex++;
      await this.playNext(interaction.guildId || '');

      const currentSong = queue.items[queue.currentIndex];
      await interaction.reply(
        `⏭️ Skipped to the next song!\n🎵 Now playing: **${currentSong.title}**`,
      );
    } catch (error) {
      this.logger.error(
        `Error skipping song: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      await interaction.reply(
        `An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  @SlashCommand({
    name: 'stop',
    description: 'Stops playback and leaves the voice channel',
  })
  public async onStop(
    @Context() [interaction]: SlashCommandContext,
  ): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const connection = this.connections.get(interaction.guildId || '');
    const player = this.players.get(interaction.guildId || '');

    if (!connection) {
      await interaction.reply("I'm not connected to a voice channel!");
      return;
    }

    if (player) {
      player.stop();
      if (interaction.guildId) {
        this.players.delete(interaction.guildId);
      }
    }

    if (interaction.guildId) {
      this.queues.delete(interaction.guildId);
      this.textChannels.delete(interaction.guildId);
    }

    connection.destroy();
    if (interaction.guildId) {
      this.connections.delete(interaction.guildId);
    }

    await interaction.reply('Stopped playback and left the voice channel.');
  }

  @SlashCommand({
    name: 'queue',
    description: "Affiche la file d'attente actuelle",
  })
  public async onQueue(
    @Context() [interaction]: SlashCommandContext,
  ): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'Cette commande ne peut être utilisée que dans un serveur.',
        ephemeral: true,
      });
      return;
    }

    const queue = this.queues.get(interaction.guildId || '');

    if (!queue || queue.items.length === 0) {
      await interaction.reply("La file d'attente est vide !");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("🎵 File d'attente")
      .setColor('#FF0000');

    // Afficher la chanson en cours
    const currentSong = queue.items[queue.currentIndex];
    embed.addFields({
      name: '🎵 En cours de lecture',
      value: `**${currentSong.title}**`,
    });

    // Afficher les chansons suivantes
    const upcomingSongs = queue.items.slice(queue.currentIndex + 1);
    if (upcomingSongs.length > 0) {
      const upcomingList = upcomingSongs
        .map((song, index) => `${index + 1}. **${song.title}**`)
        .join('\n');
      embed.addFields({
        name: '⏭️ Chansons suivantes',
        value: upcomingList,
      });
    }

    await interaction.reply({ embeds: [embed] });
  }
}
