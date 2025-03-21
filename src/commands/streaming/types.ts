import { AudioResource } from '@discordjs/voice';

export interface QueueItem {
  title: string;
  url: string;
  resource: AudioResource;
}

export interface GuildQueue {
  items: QueueItem[];
  currentIndex: number;
}
