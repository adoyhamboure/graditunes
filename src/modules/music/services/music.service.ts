import {
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
  forwardRef,
} from "@nestjs/common";
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
} from "@discordjs/voice";
import { TextChannel, ChatInputCommandInteraction } from "discord.js";
import * as ytdl from "@distube/ytdl-core";
import { ConfigService } from "@nestjs/config";
import { BlindtestService } from "../../games/services/blindtest.service";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { QueueItem } from "../interfaces/queueItem.interface";
import { GuildQueue } from "../interfaces/guildQueue.interface";

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
export class MusicService implements OnModuleInit {
  private readonly logger = new Logger(MusicService.name);
  private connections = new Map<string, VoiceConnection>();
  private players = new Map<string, AudioPlayer>();
  private queues = new Map<string, GuildQueue>();
  private textChannels = new Map<string, TextChannel>();
  private agent: ytdl.Agent;
  private tempDir: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => BlindtestService))
    private readonly blindtestService: BlindtestService
  ) {
    this.tempDir = path.join(os.tmpdir(), "graditunes");
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir);
    }
  }

  public getPlayer(guildId: string): AudioPlayer | undefined {
    return this.players.get(guildId);
  }

  public getQueue(guildId: string): GuildQueue | undefined {
    return this.queues.get(guildId);
  }

  public getConnection(guildId: string): VoiceConnection | undefined {
    return this.connections.get(guildId);
  }

  public clearQueue(guildId: string): void {
    this.queues.delete(guildId);
  }

  public async onModuleInit(): Promise<void> {
    this.logger.log("MusicService has been initialized!");

    const apiKey = this.configService.get<string>("YOUTUBE_API_KEY");
    if (!apiKey) {
      this.logger.warn("YouTube API key is not configured!");
    } else {
      try {
        // Tester la clé API avec une requête simple
        await axios.get(`https://www.googleapis.com/youtube/v3/videos`, {
          params: {
            part: "snippet",
            chart: "mostPopular",
            maxResults: 1,
            key: apiKey,
          },
        });
        this.logger.log("YouTube API key is valid and working!");
      } catch (error) {
        this.logger.error(`YouTube API key validation failed: ${error}`);
      }
    }

    this.agent = ytdl.createAgent(this.buildYoutubeCookies());
  }

  private buildYoutubeCookies(): Cookie[] {
    return [
      {
        name: "SID",
        value: this.configService.get<string>("YT_SID") || "",
        domain: ".youtube.com",
      },
      {
        name: "HSID",
        value: this.configService.get<string>("YT_HSID") || "",
        domain: ".youtube.com",
      },
      {
        name: "SSID",
        value: this.configService.get<string>("YT_SSID") || "",
        domain: ".youtube.com",
      },
      {
        name: "APISID",
        value: this.configService.get<string>("YT_APISID") || "",
        domain: ".youtube.com",
      },
      {
        name: "SAPISID",
        value: this.configService.get<string>("YT_SAPISID") || "",
        domain: ".youtube.com",
      },
      {
        name: "__Secure-1PSID",
        value: this.configService.get<string>("YT_1PSID") || "",
        domain: ".youtube.com",
      },
      {
        name: "__Secure-1PAPISID",
        value: this.configService.get<string>("YT_1PAPISID") || "",
        domain: ".youtube.com",
      },
      {
        name: "__Secure-3PSID",
        value: this.configService.get<string>("YT_3PSID") || "",
        domain: ".youtube.com",
      },
      {
        name: "__Secure-3PAPISID",
        value: this.configService.get<string>("YT_3PAPISID") || "",
        domain: ".youtube.com",
      },
      {
        name: "LOGIN_INFO",
        value: this.configService.get<string>("YT_LOGIN_INFO") || "",
        domain: ".youtube.com",
      },
      {
        name: "VISITOR_INFO1_LIVE",
        value: this.configService.get<string>("YT_VISITOR_INFO") || "",
        domain: ".youtube.com",
      },
      {
        name: "PREF",
        value: this.configService.get<string>("YT_PREF") || "",
        domain: ".youtube.com",
      },
      {
        name: "__Secure-YEC",
        value: this.configService.get<string>("YT_SECURE_YEC") || "",
        domain: ".youtube.com",
      },
    ];
  }

  private async createQueueItem(
    url: string,
    retryCount = 0
  ): Promise<QueueItem> {
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        // Essayer d'abord sans les cookies
        const stream = ytdl(url, {
          filter: "audioonly",
          quality: "highestaudio",
          highWaterMark: 1 << 25,
          requestOptions: {
            headers: {
              Range: "bytes=0-",
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
      } catch (error) {
        this.logger.error(`Error creating queue item: ${error}`);

        // Si l'erreur persiste, essayer avec les cookies
        if (retryCount === 1) {
          try {
            const stream = ytdl(url, {
              filter: "audioonly",
              quality: "highestaudio",
              highWaterMark: 1 << 25,
              agent: this.agent,
              requestOptions: {
                headers: {
                  Range: "bytes=0-",
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

            const videoInfo = await ytdl.getBasicInfo(url, {
              agent: this.agent,
            });

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
          } catch (cookieError) {
            this.logger.error(`Error with cookies: ${cookieError}`);
          }
        }

        retryCount++;
        if (retryCount === maxRetries) {
          throw new Error(
            `Impossible de lire la vidéo après ${maxRetries} tentatives`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
      }
    }

    throw new Error("Impossible de créer l'élément de la file d'attente");
  }

  private async handlePlaylist(
    url: string,
    interaction: ChatInputCommandInteraction
  ): Promise<QueueItem[]> {
    try {
      const playlistId = url.match(/[?&]list=([^&]+)/)?.[1];
      if (!playlistId) {
        throw new Error("Invalid playlist URL");
      }

      const apiKey = this.configService.get<string>("YOUTUBE_API_KEY");
      if (!apiKey) {
        throw new Error("YouTube API key not configured");
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
            part: "contentDetails",
            id: playlistId,
            key: apiKey,
          },
        }
      );

      if (initialResponse.data.items?.[0]?.contentDetails?.itemCount) {
        totalVideos = parseInt(
          initialResponse.data.items[0].contentDetails.itemCount
        );
      }

      await interaction.editReply(
        `🎵 Chargement de la playlist... (0/${totalVideos} vidéos)`
      );

      do {
        const response = await axios.get<YouTubePlaylistItemsResponse>(
          `https://www.googleapis.com/youtube/v3/playlistItems`,
          {
            params: {
              part: "snippet",
              playlistId,
              maxResults: 50,
              key: apiKey,
              pageToken: nextPageToken,
            },
          }
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
                `Vidéo indisponible ou supprimée: ${video.snippet.title}`
              );
              skippedVideos++;
              processedVideos++;
              continue;
            }

            const videoInfo = await ytdl.getBasicInfo(videoUrl, {
              agent: this.agent,
            });
            const stream = ytdl(videoUrl, {
              filter: "audioonly",
              quality: "highestaudio",
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
                (processedVideos / totalVideos) * 100
              );
              await interaction.editReply(
                `🎵 Chargement de la playlist... (${processedVideos}/${totalVideos} vidéos) - ${progress}%\n${skippedVideos > 0 ? `⚠️ ${skippedVideos} vidéo(s) ignorée(s) car indisponible(s)` : ""}`
              );
            }
          } catch (error) {
            this.logger.warn(
              `Vidéo ignorée: ${video.snippet.title} - ${error instanceof Error ? error.message : "Erreur inconnue"}`
            );
            skippedVideos++;
            processedVideos++;
          }
        }

        nextPageToken = response.data.nextPageToken;
      } while (nextPageToken);

      if (items.length === 0) {
        throw new Error("Aucune vidéo disponible dans la playlist");
      }

      // Message final avec le résumé
      await interaction.editReply(
        `✅ Chargement terminé !\n${items.length} vidéo(s) chargée(s)\n${skippedVideos > 0 ? `⚠️ ${skippedVideos} vidéo(s) ignorée(s) car indisponible(s)` : ""}`
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
      this.logger.log("Player is idle");
      const queue = this.queues.get(guildId);
      if (queue) {
        queue.currentIndex++;
        void this.playNext(guildId);
      }
    });

    player.on("error", (error: Error) => {
      this.logger.error(`Player error: ${error.message}`);
    });

    this.players.set(guildId, player);
    return player;
  }

  private async playNext(guildId: string): Promise<void> {
    const queue = this.queues.get(guildId);
    const player = this.players.get(guildId);

    if (!queue || !player) return;

    // Type guard pour GuildQueue
    const isValidGuildQueue = (q: unknown): q is GuildQueue => {
      if (typeof q !== "object" || q === null) return false;

      const queue = q as { items?: unknown; currentIndex?: unknown };
      return (
        Array.isArray(queue.items) && typeof queue.currentIndex === "number"
      );
    };

    // Type guard pour QueueItem
    const isValidQueueItem = (item: unknown): item is QueueItem => {
      if (typeof item !== "object" || item === null) return false;

      const queueItem = item as {
        title?: unknown;
        url?: unknown;
        resource?: unknown;
      };
      return (
        typeof queueItem.title === "string" &&
        typeof queueItem.url === "string" &&
        queueItem.resource !== undefined &&
        queueItem.resource !== null
      );
    };

    if (!isValidGuildQueue(queue)) {
      this.logger.error("Invalid queue structure");
      return;
    }

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
    if (!isValidQueueItem(currentItem)) {
      this.logger.error("Invalid queue item structure");
      return;
    }

    player.play(currentItem.resource);

    try {
      await entersState(player, AudioPlayerStatus.Playing, 10_000);
      this.logger.log(`Now playing: ${currentItem.title}`);

      const textChannel = this.textChannels.get(guildId);
      if (textChannel) {
        await textChannel.send(
          `🎵 En cours de lecture: **${currentItem.title}**`
        );
      }
    } catch (error) {
      this.logger.error("Failed to start playback");
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
    textChannelId: string,
    query: string,
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    try {
      if (!interaction.guild) {
        throw new Error("Guild not found");
      }

      if (!interaction.channel) {
        throw new Error("Channel not found");
      }

      // Create or get connection
      let connection = this.connections.get(guildId);
      if (!connection) {
        connection = joinVoiceChannel({
          channelId: voiceChannelId,
          guildId: guildId,
          adapterCreator: interaction.guild.voiceAdapterCreator,
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
        this.logger.error("Connection failed to become ready");
        throw new Error("Échec de la connexion au canal vocal");
      }

      // Subscribe to player
      const subscription = connection.subscribe(player);
      if (!subscription) {
        throw new Error("Échec de la souscription au lecteur");
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
      const queueItem = await this.createQueueItem(query);

      // Si aucune musique n'est en cours de lecture, démarrer la nouvelle
      if (
        queue.items.length === 0 ||
        player.state.status === AudioPlayerStatus.Idle
      ) {
        queue.items = [queueItem];
        queue.currentIndex = 0;
        // Start playing
        await this.playNext(guildId);
      } else {
        // Sinon, ajouter à la file d'attente
        queue.items.push(queueItem);
        // Afficher un message dans le canal de texte
        const textChannel = this.textChannels.get(guildId);
        if (textChannel) {
          await textChannel.send(
            `✅ **${queueItem.title}** a été ajouté à la file d'attente !`
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error playing music: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      throw error;
    }
  }

  public async searchAndGetVideoUrl(query: string): Promise<string | null> {
    const maxRetries = 3;

    try {
      const apiKey = this.configService.get<string>("YOUTUBE_API_KEY");
      if (!apiKey) {
        throw new Error(
          "YOUTUBE_API_KEY is not defined in environment variables"
        );
      }

      // Ajouter un délai entre les requêtes pour éviter de surcharger l'API
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const url = `https://www.googleapis.com/youtube/v3/search`;
      const baseParams = {
        part: "snippet",
        q: query,
        type: "video",
        maxResults: 1,
        key: apiKey,
        regionCode: "FR",
        videoEmbeddable: "true",
        order: "relevance",
      };

      // D'abord, essayer avec des vidéos courtes (< 4 minutes)
      const shortParams = { ...baseParams, videoDuration: "short" };
      this.logger.debug(`Paramètres (short): ${JSON.stringify(shortParams)}`);
      let response = await axios.get<YouTubeSearchResponse>(url, {
        params: shortParams,
      });

      // Si aucun résultat, essayer avec des vidéos moyennes (4-20 minutes)
      if (!response.data.items || response.data.items.length === 0) {
        const mediumParams = { ...baseParams, videoDuration: "medium" };
        this.logger.debug(
          `Paramètres (medium): ${JSON.stringify(mediumParams)}`
        );
        response = await axios.get<YouTubeSearchResponse>(url, {
          params: mediumParams,
        });
      }

      if (response.data.items && response.data.items.length > 0) {
        const videoId = response.data.items[0].id.videoId;
        return `https://www.youtube.com/watch?v=${videoId}`;
      }

      throw new Error("Aucune vidéo trouvée");
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        if (maxRetries > 0) {
          this.logger.warn(
            `Erreur 403 détectée, tentative ${maxRetries}/${maxRetries}`
          );
          // Attendre un peu plus longtemps avant de réessayer
          await new Promise((resolve) =>
            setTimeout(resolve, 2000 * (maxRetries - 1))
          );
          return this.searchAndGetVideoUrl(query);
        }
      }

      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Erreur YouTube API: ${error.response?.status} - ${error.response?.statusText}`
        );
        this.logger.error(
          `Détails de l'erreur: ${JSON.stringify(error.response?.data)}`
        );
      }
      this.logger.error(`Error searching for video: ${error}`);
      return null;
    }
  }
}
