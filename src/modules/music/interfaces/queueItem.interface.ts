import { AudioResource } from "@discordjs/voice";

export interface QueueItem {
  title: string;
  url: string;
  resource: AudioResource<unknown>;
}
