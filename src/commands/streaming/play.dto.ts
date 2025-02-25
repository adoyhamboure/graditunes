import { StringOption } from 'necord';

export class PlayDto {
  @StringOption({
    name: 'url',
    description: 'YouTube URL of the music to play',
    required: true,
  })
  url: string;
}
