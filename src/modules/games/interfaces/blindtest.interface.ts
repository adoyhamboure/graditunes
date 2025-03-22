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
    youtubeSearch: string;
    acceptable_answers: string[];
    displayableAnswer: string;
  }>;
}
