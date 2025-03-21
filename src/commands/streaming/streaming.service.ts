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
import {
  GuildMember,
  EmbedBuilder,
  TextChannel,
  ChatInputCommandInteraction,
} from 'discord.js';
import * as ytdl from '@distube/ytdl-core';
import { ConfigService } from '@nestjs/config';
import { GuildQueue, QueueItem } from './types';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface Cookie {
  name: string;
  value: string;
  domain: string;
}

interface YouTubePlaylistResponse {
  items: Array<{
    contentDetails: {
      itemCount: string;
    };
  }>;
}

interface YouTubePlaylistItemsResponse {
  items: Array<{
    snippet: {
      resourceId: {
        videoId: string;
      };
      title: string;
    };
  }>;
  nextPageToken?: string;
}

interface YouTubeSearchResponse {
  items: Array<{
    id: {
      videoId: string;
    };
  }>;
}

@Injectable()
export class StreamingService implements OnModuleInit {
  private readonly logger = new Logger(StreamingService.name);
  private connections = new Map<string, VoiceConnection>();
  private players = new Map<string, AudioPlayer>();
  private queues = new Map<string, GuildQueue>();
  private textChannels = new Map<string, TextChannel>();
  private agent: ytdl.Agent;
  private tempDir: string;

  constructor(private readonly configService: ConfigService) {
    // Créer un dossier temporaire pour les fichiers audio
    this.tempDir = path.join(os.tmpdir(), 'graditunes');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir);
    }
  }

  public getPlayer(guildId: string): AudioPlayer | undefined {
    return this.players.get(guildId);
  }

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

  private async createQueueItem(
    url: string,
    retryCount = 0,
  ): Promise<QueueItem> {
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        const stream = ytdl(url, {
          filter: 'audioonly',
          quality: 'highestaudio',
          highWaterMark: 1 << 25,
          agent: this.agent,
          requestOptions: {
            headers: {
              Range: 'bytes=0-',
            },
          },
          begin: 0,
          liveBuffer: 10000,
          dlChunkSize: 0,
          range: {
            start: 0,
            end: 0,
          },
        });

        const videoInfo = await ytdl.getBasicInfo(url, { agent: this.agent });

        const resource = createAudioResource(stream, {
          inputType: StreamType.Arbitrary,
          inlineVolume: true,
          metadata: {
            title: videoInfo.videoDetails.title,
          },
        });

        if (resource.volume) {
          resource.volume.setVolume(0.5);
        }

        return {
          title: videoInfo.videoDetails.title,
          url,
          resource,
        };
      } catch (error) {
        retryCount++;

        // Si c'est une erreur 403, essayer sans les cookies
        if (
          error instanceof Error &&
          error.message.includes('Status code: 403')
        ) {
          this.logger.warn(
            `Erreur 403 détectée, tentative ${retryCount}/${maxRetries} sans cookies`,
          );
          try {
            const stream = ytdl(url, {
              filter: 'audioonly',
              quality: 'highestaudio',
              highWaterMark: 1 << 25,
              requestOptions: {
                headers: {
                  Range: 'bytes=0-',
                },
              },
              begin: 0,
              liveBuffer: 10000,
              dlChunkSize: 0,
              range: {
                start: 0,
                end: 0,
              },
            });

            const videoInfo = await ytdl.getBasicInfo(url);

            const resource = createAudioResource(stream, {
              inputType: StreamType.Arbitrary,
              inlineVolume: true,
              metadata: {
                title: videoInfo.videoDetails.title,
              },
            });

            if (resource.volume) {
              resource.volume.setVolume(0.5);
            }

            return {
              title: videoInfo.videoDetails.title,
              url,
              resource,
            };
          } catch (retryError) {
            this.logger.error(
              `Erreur lors de la tentative sans cookies: ${retryError}`,
            );
          }
        }

        // Si c'est la dernière tentative, lancer l'erreur
        if (retryCount === maxRetries) {
          this.logger.error(`Échec après ${maxRetries} tentatives: ${error}`);
          throw new Error(
            `Impossible de lire la vidéo après ${maxRetries} tentatives: ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
          );
        }

        // Attendre un peu avant de réessayer
        await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
      }
    }

    throw new Error("Impossible de créer l'élément de la file d'attente");
  }

  private async handlePlaylist(
    url: string,
    interaction: ChatInputCommandInteraction,
  ): Promise<QueueItem[]> {
    try {
      const playlistId = url.match(/[?&]list=([^&]+)/)?.[1];
      if (!playlistId) {
        throw new Error('Invalid playlist URL');
      }

      const apiKey = this.configService.get<string>('YOUTUBE_API_KEY');
      if (!apiKey) {
        throw new Error('YouTube API key not configured');
      }

      const items: QueueItem[] = [];
      let nextPageToken: string | undefined;
      let totalVideos = 0;
      let processedVideos = 0;
      let skippedVideos = 0;

      // Première requête pour obtenir le nombre total de vidéos
      const initialResponse = await axios.get<YouTubePlaylistResponse>(
        `https://www.googleapis.com/youtube/v3/playlists`,
        {
          params: {
            part: 'contentDetails',
            id: playlistId,
            key: apiKey,
          },
        },
      );

      if (initialResponse.data.items?.[0]?.contentDetails?.itemCount) {
        totalVideos = parseInt(
          initialResponse.data.items[0].contentDetails.itemCount,
        );
      }

      await interaction.editReply(
        `🎵 Chargement de la playlist... (0/${totalVideos} vidéos)`,
      );

      do {
        const response = await axios.get<YouTubePlaylistItemsResponse>(
          `https://www.googleapis.com/youtube/v3/playlistItems`,
          {
            params: {
              part: 'snippet',
              playlistId,
              maxResults: 50,
              key: apiKey,
              pageToken: nextPageToken,
            },
          },
        );

        const videos = response.data.items;
        if (!videos || videos.length === 0) {
          break;
        }

        for (const video of videos) {
          try {
            const videoId = video.snippet.resourceId.videoId;
            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

            // Vérifier d'abord si la vidéo est disponible
            try {
              await ytdl.getBasicInfo(videoUrl, { agent: this.agent });
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (error) {
              this.logger.warn(
                `Vidéo indisponible ou supprimée: ${video.snippet.title}`,
              );
              skippedVideos++;
              processedVideos++;
              continue;
            }

            const videoInfo = await ytdl.getBasicInfo(videoUrl, {
              agent: this.agent,
            });
            const stream = ytdl(videoUrl, {
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

            items.push({
              title: videoInfo.videoDetails.title,
              url: videoUrl,
              resource,
            });

            processedVideos++;
            // Mettre à jour le message tous les 5 vidéos ou à la fin
            if (processedVideos % 5 === 0 || processedVideos === totalVideos) {
              const progress = Math.round(
                (processedVideos / totalVideos) * 100,
              );
              await interaction.editReply(
                `🎵 Chargement de la playlist... (${processedVideos}/${totalVideos} vidéos) - ${progress}%\n${skippedVideos > 0 ? `⚠️ ${skippedVideos} vidéo(s) ignorée(s) car indisponible(s)` : ''}`,
              );
            }
          } catch (error) {
            this.logger.warn(
              `Vidéo ignorée: ${video.snippet.title} - ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
            );
            skippedVideos++;
            processedVideos++;
          }
        }

        nextPageToken = response.data.nextPageToken;
      } while (nextPageToken);

      if (items.length === 0) {
        throw new Error('Aucune vidéo disponible dans la playlist');
      }

      // Message final avec le résumé
      await interaction.editReply(
        `✅ Chargement terminé !\n${items.length} vidéo(s) chargée(s)\n${skippedVideos > 0 ? `⚠️ ${skippedVideos} vidéo(s) ignorée(s) car indisponible(s)` : ''}`,
      );

      return items;
    } catch (error) {
      this.logger.error(`Error processing playlist: ${error}`);
      throw error;
    }
  }

  private createPlayer(guildId: string): AudioPlayer {
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

  private isValidYoutubeUrl(url: string): boolean {
    const videoPattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;
    const playlistPattern =
      /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+playlist\?list=.+$/;
    return videoPattern.test(url) || playlistPattern.test(url);
  }

  public async playMusic(
    guildId: string,
    voiceChannelId: string,
    url: string,
    guild: { voiceAdapterCreator: (guild: any) => any },
  ): Promise<void> {
    try {
      // Handle existing connection
      let connection = this.connections.get(guildId);
      if (connection) {
        if (connection.state.status === VoiceConnectionStatus.Destroyed) {
          this.connections.delete(guildId);
          connection = undefined;
        }
      }

      // Create new connection
      if (!connection) {
        connection = joinVoiceChannel({
          channelId: voiceChannelId,
          guildId: guildId,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: true,
          selfMute: false,
        });
        this.connections.set(guildId, connection);
      }

      // Create or get player
      let player = this.players.get(guildId);
      if (!player) {
        player = this.createPlayer(guildId);
      }

      // Wait for connection to be ready
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      } catch {
        this.logger.error('Connection failed to become ready');
        throw new Error('Échec de la connexion au canal vocal');
      }

      // Subscribe to player
      const subscription = connection.subscribe(player);
      if (!subscription) {
        throw new Error('Échec de la souscription au lecteur');
      }

      // Initialize or get queue
      let queue = this.queues.get(guildId);
      if (!queue) {
        queue = {
          items: [],
          currentIndex: 0,
        };
        this.queues.set(guildId, queue);
      }

      // Create queue item
      const queueItem = await this.createQueueItem(url);
      queue.items = [queueItem];
      queue.currentIndex = 0;

      // Start playing
      await this.playNext(guildId);
    } catch (error) {
      this.logger.error(
        `Error playing music: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  @SlashCommand({
    name: 'play',
    description: 'Joue une chanson ou une playlist depuis YouTube',
  })
  public async onPlay(
    @Context() [interaction]: SlashCommandContext,
    @Options() { url }: PlayDto,
  ): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'Cette commande ne peut être utilisée que dans un serveur.',
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
          'Vous devez être dans un canal vocal pour utiliser cette commande !',
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
      if (!this.isValidYoutubeUrl(url)) {
        await interaction.editReply(
          'Veuillez fournir une URL YouTube ou une URL de playlist valide.',
        );
        return;
      }

      // Check if it's a playlist
      const isPlaylist = url.includes('playlist?list=');
      if (isPlaylist) {
        const items = await this.handlePlaylist(url, interaction);
        if (items.length === 0) {
          await interaction.editReply(
            "Aucune vidéo n'a pu être chargée depuis la playlist.",
          );
          return;
        }

        // Initialiser ou obtenir la file d'attente
        let queue = this.queues.get(interaction.guildId || '');
        if (!queue) {
          queue = {
            items: [],
            currentIndex: 0,
          };
          this.queues.set(interaction.guildId || '', queue);
        }

        // Ajouter les vidéos de la playlist à la file d'attente existante
        const currentItems = queue.items;
        queue.items = [...currentItems, ...items];

        // Si aucune musique n'est en cours de lecture, démarrer la première
        const player = this.players.get(interaction.guildId || '');
        if (!player || player.state.status === AudioPlayerStatus.Idle) {
          if (!interaction.guildId) {
            throw new Error('Guild ID is required');
          }
          await this.playMusic(
            interaction.guildId,
            voiceChannel.id,
            items[0].url,
            interaction.guild,
          );
        }

        await interaction.editReply(
          `✅ ${items.length} vidéo(s) ajoutée(s) à la file d'attente !\nUtilisez \`/queue\` pour voir la file d'attente complète.`,
        );
      } else {
        if (!interaction.guildId) {
          throw new Error('Guild ID is required');
        }
        await this.playMusic(
          interaction.guildId,
          voiceChannel.id,
          url,
          interaction.guild,
        );
        await interaction.deleteReply();
      }
    } catch (error) {
      this.logger.error(
        `Error playing music: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      await interaction.editReply(
        `Une erreur est survenue: ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
      );
    }
  }

  @SlashCommand({
    name: 'skip',
    description: "Passe à la chanson suivante dans la file d'attente",
  })
  public async onSkip(
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
    const player = this.players.get(interaction.guildId || '');

    if (!queue || !player) {
      await interaction.reply("Aucune musique n'est en cours de lecture !");
      return;
    }

    try {
      // Vérifier si c'est la dernière chanson
      if (queue.currentIndex >= queue.items.length - 1) {
        player.stop();
        await interaction.reply(
          "⏭️ Dernière chanson de la file d'attente. Arrêt de la lecture.",
        );
        return;
      }

      queue.currentIndex++;
      await this.playNext(interaction.guildId || '');

      await interaction.reply('⏭️ Passage à la chanson suivante !');
    } catch (error) {
      this.logger.error(
        `Error skipping song: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      await interaction.reply(
        `Une erreur est survenue: ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
      );
    }
  }

  @SlashCommand({
    name: 'stop',
    description: 'Arrête la lecture et quitte le canal vocal',
  })
  public async onStop(
    @Context() [interaction]: SlashCommandContext,
  ): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'Cette commande ne peut être utilisée que dans un serveur.',
        ephemeral: true,
      });
      return;
    }

    const connection = this.connections.get(interaction.guildId || '');
    const player = this.players.get(interaction.guildId || '');

    if (!connection) {
      await interaction.reply('Je ne suis pas connecté à un canal vocal !');
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

    await interaction.reply('Lecture arrêtée et déconnexion du canal vocal.');
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
      // Diviser les chansons en groupes de 10
      const songsPerField = 10;
      for (let i = 0; i < upcomingSongs.length; i += songsPerField) {
        const chunk = upcomingSongs.slice(i, i + songsPerField);
        const chunkList = chunk
          .map((song, index) => `${i + index + 1}. **${song.title}**`)
          .join('\n');

        embed.addFields({
          name: `⏭️ Chansons suivantes (${i + 1}-${Math.min(i + songsPerField, upcomingSongs.length)})`,
          value: chunkList,
        });
      }
    }

    await interaction.reply({ embeds: [embed] });
  }

  @SlashCommand({
    name: 'clear_queue',
    description: "Vide complètement la file d'attente",
  })
  public async onClearQueue(
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
      await interaction.reply("La file d'attente est déjà vide !");
      return;
    }

    try {
      // Garder uniquement la chanson en cours de lecture
      const currentSong = queue.items[queue.currentIndex];
      queue.items = [currentSong];
      queue.currentIndex = 0;

      await interaction.reply("🗑️ La file d'attente a été vidée !");
    } catch (error) {
      this.logger.error(
        `Error clearing queue: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      await interaction.reply(
        `Une erreur est survenue: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  public async searchAndGetVideoUrl(searchQuery: string): Promise<string> {
    try {
      const apiKey = this.configService.get<string>('YOUTUBE_API_KEY');
      if (!apiKey) {
        throw new Error(
          'YOUTUBE_API_KEY is not defined in environment variables',
        );
      }

      // Ajouter un délai entre les requêtes pour éviter de surcharger l'API
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const url = `https://www.googleapis.com/youtube/v3/search`;
      const params = {
        part: 'snippet',
        q: searchQuery,
        type: 'video',
        maxResults: 1,
        key: apiKey,
        regionCode: 'FR',
        videoEmbeddable: 'true',
        videoDuration: 'medium',
        order: 'relevance',
      };

      this.logger.debug(`Paramètres: ${JSON.stringify(params)}`);

      const response = await axios.get<YouTubeSearchResponse>(url, { params });

      if (response.data.items && response.data.items.length > 0) {
        const videoId = response.data.items[0].id.videoId;
        return `https://www.youtube.com/watch?v=${videoId}`;
      }

      throw new Error('Aucune vidéo trouvée');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Erreur YouTube API: ${error.response?.status} - ${error.response?.statusText}`,
        );
        this.logger.error(
          `Détails de l'erreur: ${JSON.stringify(error.response?.data)}`,
        );
      }
      this.logger.error(`Error searching for video: ${error}`);
      throw error;
    }
  }
}
