export interface BlindtestQuestion {
  url: string;
  acceptable_answers: string[];
  meta: {
    type: string;
    source: string;
    title: string;
    composer: string;
  };
}

export interface Blindtest {
  theme: string;
  answerType: string;
  questions: Array<{
    meta: {
      type: string;
      source: string;
      title: string;
      composer: string;
    };
    url?: string;
    acceptable_answers: string[];
    displayableAnswer: string;
  }>;
}

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
}

export interface Question {
  url: string;
  acceptable_answers: string[];
  meta: {
    type: string;
    source: string;
    title: string;
    composer: string;
  };
}
