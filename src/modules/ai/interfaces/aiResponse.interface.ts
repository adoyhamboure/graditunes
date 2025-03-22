export interface AIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}
