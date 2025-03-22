export interface Question {
  url: string;
  youtubeSearch: string;
  acceptable_answers: string[];
  meta: {
    type: string;
    source: string;
    title: string;
    composer: string;
  };
}
