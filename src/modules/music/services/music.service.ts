import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
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
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { exec as execCallback } from "child_process";
import { QueueItem } from "../interfaces/queueItem.interface";
import { GuildQueue } from "../interfaces/guildQueue.interface";

const exec = promisify(execCallback);

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

  constructor(private readonly configService: ConfigService) {
    this.tempDir = path.join(process.cwd(), "temp");
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
        this.logger.log(
          `Tentative ${retryCount + 1}/${maxRetries} de téléchargement pour ${url}`
        );

        // Créer un nom de fichier unique basé sur l'horodatage
        const timestamp = Date.now();
        const outputFile = path.join(this.tempDir, `${timestamp}.mp3`);
        this.logger.log(`Fichier de sortie: ${outputFile}`);

        // Exécuter yt-dlp pour télécharger l'audio
        this.logger.log("Démarrage du téléchargement avec yt-dlp...");
        const downloadCommand = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputFile}" "${url}" --verbose`;
        this.logger.log(`Commande exécutée: ${downloadCommand}`);

        const { stdout, stderr } = await exec(downloadCommand);

        // Log de la sortie standard
        if (stdout) {
          this.logger.log(`yt-dlp stdout: ${stdout}`);
        }

        // Log des avertissements/erreurs
        if (stderr) {
          this.logger.warn(`yt-dlp stderr: ${stderr}`);
        }

        // Vérifier que le fichier existe
        if (!fs.existsSync(outputFile)) {
          this.logger.error(`Le fichier ${outputFile} n'a pas été créé`);
          throw new Error(
            "Le fichier audio n'a pas été téléchargé correctement"
          );
        }
        this.logger.log(`Fichier téléchargé avec succès: ${outputFile}`);

        // Obtenir les informations de la vidéo
        this.logger.log("Récupération du titre de la vidéo...");
        const titleCommand = `yt-dlp --get-title "${url}" --verbose`;
        this.logger.log(`Commande exécutée: ${titleCommand}`);

        const { stdout: videoInfo, stderr: titleError } =
          await exec(titleCommand);

        if (titleError) {
          this.logger.warn(
            `Erreur lors de la récupération du titre: ${titleError}`
          );
        }

        const title = videoInfo.trim();
        this.logger.log(`Titre récupéré: ${title}`);

        // Vérifier la taille du fichier
        const stats = fs.statSync(outputFile);
        this.logger.log(`Taille du fichier: ${stats.size} bytes`);

        // Créer la ressource audio
        this.logger.log("Création de la ressource audio...");
        const resource = createAudioResource(outputFile, {
          inputType: StreamType.Arbitrary,
          inlineVolume: true,
        });

        if (!resource) {
          throw new Error("Impossible de créer la ressource audio");
        }

        if (resource.volume) {
          resource.volume.setVolume(0.5);
          this.logger.log("Volume de la ressource réglé à 0.5");
        }

        // Vérifier l'état de la ressource
        this.logger.log(
          `État de la ressource: ${resource.ended ? "Terminé" : "Prêt"}`
        );
        this.logger.log(`Type de ressource: ${resource.playbackDuration}`);

        this.logger.log("QueueItem créé avec succès");
        return {
          title,
          url,
          resource,
          filePath: outputFile,
        };
      } catch (error) {
        this.logger.error(
          `Erreur lors de la création du QueueItem: ${error instanceof Error ? error.message : "Erreur inconnue"}`
        );
        if (error instanceof Error && error.stack) {
          this.logger.error(`Stack trace: ${error.stack}`);
        }
        retryCount++;

        if (retryCount === maxRetries) {
          throw new Error(
            `Impossible de lire la vidéo après ${maxRetries} tentatives`
          );
        }

        this.logger.log(
          `Attente de ${1000 * retryCount}ms avant la prochaine tentative...`
        );
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

            const timestamp = Date.now();
            const outputFile = path.join(this.tempDir, `${timestamp}.mp3`);

            // Télécharger l'audio avec yt-dlp
            const { stderr } = await exec(
              `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputFile}" "${videoUrl}"`
            );

            if (stderr) {
              this.logger.warn(`yt-dlp warning: ${stderr}`);
            }

            // Vérifier que le fichier existe
            if (!fs.existsSync(outputFile)) {
              throw new Error(
                "Le fichier audio n'a pas été téléchargé correctement"
              );
            }

            // Obtenir les informations de la vidéo
            const { stdout: videoInfo } = await exec(
              `yt-dlp --get-title "${videoUrl}"`
            );
            const title = videoInfo.trim();

            const resource = createAudioResource(outputFile, {
              inputType: StreamType.Arbitrary,
              inlineVolume: true,
            });

            if (resource.volume) {
              resource.volume.setVolume(0.5);
            }

            items.push({
              title,
              url: videoUrl,
              resource,
              filePath: outputFile,
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

    player.on(AudioPlayerStatus.Idle, () => {
      this.logger.log("Player is idle");
      const queue = this.queues.get(guildId);
      if (queue) {
        queue.currentIndex++;
        void this.playNext(guildId);
      }
    });

    player.on(AudioPlayerStatus.Playing, () => {
      this.logger.log("Le lecteur a commencé à jouer");
    });

    player.on(AudioPlayerStatus.Buffering, () => {
      this.logger.log("Le lecteur est en train de mettre en mémoire tampon");
    });

    player.on(AudioPlayerStatus.AutoPaused, () => {
      this.logger.log("Le lecteur s'est mis en pause automatiquement");
    });

    player.on(AudioPlayerStatus.Paused, () => {
      this.logger.log("Le lecteur est en pause");
    });

    player.on("error", (error: Error) => {
      this.logger.error(`Player error: ${error.message}`);
      if (error.stack) {
        this.logger.error(`Stack trace: ${error.stack}`);
      }
    });

    player.on("stateChange", (oldState, newState) => {
      this.logger.log(
        `État du lecteur changé de ${oldState.status} à ${newState.status}`
      );
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
        filePath?: unknown;
      };
      return (
        typeof queueItem.title === "string" &&
        typeof queueItem.url === "string" &&
        queueItem.resource !== undefined &&
        queueItem.resource !== null &&
        typeof queueItem.filePath === "string"
      );
    };

    if (!isValidGuildQueue(queue)) {
      this.logger.error("Invalid queue structure");
      return;
    }

    // Nettoyer le fichier de la chanson précédente si elle existe
    if (queue.currentIndex > 0) {
      const previousItem = queue.items[queue.currentIndex - 1];
      if (
        isValidQueueItem(previousItem) &&
        fs.existsSync(previousItem.filePath)
      ) {
        try {
          fs.unlinkSync(previousItem.filePath);
          this.logger.log(`Fichier nettoyé: ${previousItem.filePath}`);
        } catch (error) {
          this.logger.error(`Erreur lors du nettoyage du fichier: ${error}`);
        }
      }
    }

    if (queue.currentIndex >= queue.items.length) {
      // Nettoyer le dernier fichier
      const lastItem = queue.items[queue.items.length - 1];
      if (isValidQueueItem(lastItem) && fs.existsSync(lastItem.filePath)) {
        try {
          fs.unlinkSync(lastItem.filePath);
          this.logger.log(`Dernier fichier nettoyé: ${lastItem.filePath}`);
        } catch (error) {
          this.logger.error(
            `Erreur lors du nettoyage du dernier fichier: ${error}`
          );
        }
      }

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

    this.logger.log(`Tentative de lecture de: ${currentItem.title}`);
    this.logger.log(`Chemin du fichier: ${currentItem.filePath}`);

    // Vérifier que le fichier existe toujours
    if (!fs.existsSync(currentItem.filePath)) {
      this.logger.error(`Le fichier ${currentItem.filePath} n'existe pas`);
      return;
    }

    // Vérifier la taille du fichier
    const stats = fs.statSync(currentItem.filePath);
    this.logger.log(`Taille du fichier à lire: ${stats.size} bytes`);

    player.play(currentItem.resource);

    try {
      this.logger.log(
        `État du lecteur avant la lecture: ${player.state.status}`
      );
      await entersState(player, AudioPlayerStatus.Playing, 10_000);
      this.logger.log(
        `État du lecteur après la lecture: ${player.state.status}`
      );
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
