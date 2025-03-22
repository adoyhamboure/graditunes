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
import {
  TextChannel,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { exec as execCallback } from "child_process";
import { QueueItem } from "../interfaces/queueItem.interface";
import { GuildQueue } from "../interfaces/guildQueue.interface";

const exec = promisify(execCallback);

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
  }

  private async cleanupTempFiles(): Promise<void> {
    if (fs.existsSync(this.tempDir)) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const files = fs.readdirSync(this.tempDir);
        for (const file of files) {
          const filePath = path.join(this.tempDir, file);
          fs.unlinkSync(filePath);
          this.logger.log(`Fichier temporaire supprimés: ${filePath}`);
        }
      } catch (error) {
        this.logger.error(
          `Erreur lors du nettoyage des fichiers temporaires: ${error}`
        );
      }
    }
  }

  private isValidYoutubeUrl(url: string): boolean {
    const videoPattern =
      /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]+/;
    const playlistPattern =
      /^(https?:\/\/)?(www\.)?(youtube\.com\/playlist\?list=)[a-zA-Z0-9_-]+$/;
    return videoPattern.test(url) || playlistPattern.test(url);
  }

  private cleanYoutubeUrl(url: string): string {
    try {
      const urlObj = new URL(url);

      // Si c'est une URL de playlist pure (sans watch?v=), on la laisse telle quelle
      if (urlObj.pathname === "/playlist") {
        return url;
      }

      // Si c'est une URL de vidéo (avec ou sans paramètres de playlist)
      if (urlObj.pathname === "/watch") {
        const videoId = urlObj.searchParams.get("v");
        if (!videoId) {
          throw new Error("ID de vidéo non trouvé dans l'URL");
        }
        // On ne garde que le paramètre v pour les vidéos individuelles
        return `https://www.youtube.com/watch?v=${videoId}`;
      }

      // Pour les URLs youtu.be
      if (urlObj.hostname === "youtu.be") {
        const videoId = urlObj.pathname.slice(1); // Enlever le '/' initial
        return `https://www.youtube.com/watch?v=${videoId}`;
      }

      return url;
    } catch (error) {
      this.logger.error(`Erreur lors du nettoyage de l'URL: ${error}`);
      return url;
    }
  }

  private async createQueueItem(
    url: string,
    retryCount = 0
  ): Promise<QueueItem> {
    const maxRetries = 3;

    // Vérifier si l'URL est valide
    if (!this.isValidYoutubeUrl(url)) {
      throw new Error("URL YouTube invalide");
    }

    // Nettoyer l'URL
    const cleanedUrl = this.cleanYoutubeUrl(url);
    this.logger.log(`URL nettoyée: ${cleanedUrl}`);

    while (retryCount < maxRetries) {
      try {
        this.logger.log(
          `Tentative ${retryCount + 1}/${maxRetries} de téléchargement pour ${cleanedUrl}`
        );

        // Créer un nom de fichier unique basé sur l'horodatage
        const timestamp = Date.now();
        const outputFile = path.join(this.tempDir, `${timestamp}.mp3`);
        this.logger.log(`Fichier de sortie: ${outputFile}`);

        // Exécuter yt-dlp pour télécharger l'audio
        this.logger.log("Démarrage du téléchargement avec yt-dlp...");
        const downloadCommand = `yt-dlp -x --audio-format mp3 --audio-quality 3 -o "${outputFile}" "${cleanedUrl}" --verbose`;
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
        const titleCommand = `yt-dlp --get-title "${cleanedUrl}" --verbose`;
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
          url: cleanedUrl,
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

  private async updateQueueMessage(guildId: string): Promise<void> {
    const textChannel = this.textChannels.get(guildId);
    const queue = this.queues.get(guildId);

    if (!textChannel || !queue) return;

    const embed = new EmbedBuilder()
      .setTitle("File d'attente mise à jour")
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

    await textChannel.send({ embeds: [embed] });
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
        // Mettre à jour le message de la file d'attente
        void this.updateQueueMessage(guildId);
      } else {
        void this.cleanupTempFiles();
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
          // Attendre un peu pour s'assurer que le fichier n'est plus utilisé
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Vérifier si le fichier existe toujours avant de le supprimer
          if (fs.existsSync(previousItem.filePath)) {
            fs.unlinkSync(previousItem.filePath);
            this.logger.log(`Fichier nettoyé: ${previousItem.filePath}`);
          }
        } catch (error) {
          if ((error as { code?: string }).code === "EBUSY") {
            this.logger.warn(
              `Le fichier ${previousItem.filePath} est encore en cours d'utilisation, il sera nettoyé plus tard`
            );
          } else {
            this.logger.error(`Erreur lors du nettoyage du fichier: ${error}`);
          }
        }
      }
    }

    if (queue.currentIndex >= queue.items.length) {
      // Nettoyer le dernier fichier
      const lastItem = queue.items[queue.items.length - 1];
      if (isValidQueueItem(lastItem) && fs.existsSync(lastItem.filePath)) {
        try {
          // Attendre un peu pour s'assurer que le fichier n'est plus utilisé
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Vérifier si le fichier existe toujours avant de le supprimer
          if (fs.existsSync(lastItem.filePath)) {
            fs.unlinkSync(lastItem.filePath);
            this.logger.log(`Dernier fichier nettoyé: ${lastItem.filePath}`);
          }
        } catch (error) {
          if ((error as { code?: string }).code === "EBUSY") {
            this.logger.warn(
              `Le fichier ${lastItem.filePath} est encore en cours d'utilisation, il sera nettoyé plus tard`
            );
          } else {
            this.logger.error(
              `Erreur lors du nettoyage du dernier fichier: ${error}`
            );
          }
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

      // Mettre à jour le message de la file d'attente
      await this.updateQueueMessage(guildId);

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

      // Stocker le canal de texte pour les messages
      const textChannel = interaction.channel as TextChannel;
      this.textChannels.set(guildId, textChannel);

      await interaction.editReply("🔍 Recherche de votre musique...");

      // Create or get connection
      let connection = this.connections.get(guildId);
      if (!connection) {
        await interaction.editReply("🎵 Connexion au canal vocal...");
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
        await interaction.editReply(
          "❌ Impossible de se connecter au canal vocal. Veuillez réessayer."
        );
        throw new Error("Échec de la connexion au canal vocal");
      }

      // Subscribe to player
      const subscription = connection.subscribe(player);
      if (!subscription) {
        await interaction.editReply(
          "❌ Une erreur est survenue lors de la connexion au canal vocal."
        );
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

      await interaction.editReply("⏬ Téléchargement de votre musique...");

      // Create queue item
      const queueItem = await this.createQueueItem(query);

      // Si aucune musique n'est en cours de lecture, démarrer la nouvelle
      if (
        queue.items.length === 0 ||
        player.state.status === AudioPlayerStatus.Idle
      ) {
        queue.items = [queueItem];
        queue.currentIndex = 0;
        await interaction.editReply("▶️ Démarrage de la lecture...");
        // Start playing
        await this.playNext(guildId);
      } else {
        // Sinon, ajouter à la file d'attente
        queue.items.push(queueItem);
        await interaction.editReply(
          `✅ **${queueItem.title}** a été ajouté à la file d'attente !`
        );
      }
    } catch (error) {
      this.logger.error(
        `Error playing music: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      await interaction.editReply(
        "❌ Une erreur est survenue lors de la lecture de la musique. Veuillez réessayer."
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
