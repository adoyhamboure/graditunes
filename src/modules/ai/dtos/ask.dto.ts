import { StringOption } from "necord";

export class AskDto {
  @StringOption({
    name: "prompt",
    description: "Votre question pour l'IA",
    required: true,
  })
  prompt: string;
}
