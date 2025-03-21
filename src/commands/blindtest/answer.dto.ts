import { StringOption } from 'necord';

export class AnswerDto {
  @StringOption({
    name: 'reponse',
    description: 'Votre réponse à la question',
    required: true,
  })
  reponse: string;
}
