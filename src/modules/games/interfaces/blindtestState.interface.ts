import { Blindtest } from "./blindtest.interface";

export interface BlindtestState {
  isActive: boolean;
  currentQuestionIndex: number;
  scores: Map<string, number>;
  blindtest: Blindtest | null;
  isQuestionSolved: boolean;
  currentMessageId?: string;
  currentTimeout?: NodeJS.Timeout;
  duration: number;
  difficulty: string;
  aiProvider: "deepseek" | "gpt";
  answeredPlayers: Set<string>;
}
