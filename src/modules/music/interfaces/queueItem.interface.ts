import { AudioResource } from "@discordjs/voice";

export interface QueueItem {
  title: string;
  url: string;
  resource: AudioResource;
  filePath: string; // Chemin du fichier audio temporaire
}
