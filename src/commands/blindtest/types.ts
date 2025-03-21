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
  questions: BlindtestQuestion[];
}

export interface BlindtestState {
  isActive: boolean;
  currentQuestionIndex: number;
  scores: Map<string, number>;
  blindtest: Blindtest | null;
  isQuestionSolved: boolean;
  currentMessageId?: string;
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
