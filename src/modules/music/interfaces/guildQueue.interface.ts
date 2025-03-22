import { QueueItem } from './queueItem.interface';

export interface GuildQueue {
  items: QueueItem[];
  currentIndex: number;
}
