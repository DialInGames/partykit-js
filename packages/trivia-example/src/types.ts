/**
 * Shared types for Trivia Game
 * Used by server, display client, and controller clients
 */

// Trivia question structure
export type TriviaQuestion = {
  text: string;
  options: [string, string, string, string]; // Exactly 4 options
  correctAnswer: 0 | 1 | 2 | 3; // Index of correct option
};

// Player state
export type PlayerState = {
  name: string;
  score: number;
  isReady: boolean;
  isConnected: boolean;
  disconnectedAt?: number; // Timestamp for 60s grace period
  currentAnswer?: {
    optionIndex: number;
    submittedAt: number; // Timestamp for potential tiebreaker
  };
};

// Game state
export type TriviaState = {
  phase: "lobby" | "question" | "answer_reveal" | "game_over";
  players: Record<string, PlayerState>; // Keyed by clientId
  questions: TriviaQuestion[]; // 5 shuffled questions for this game
  currentQuestionIndex: number; // 0-4, or -1 if not started
  questionStartTime?: number; // Timestamp when question phase started
  questionTimeLimit: 60; // Seconds - constant
  lastQuestionResults?: {
    correctAnswer: number;
    playersCorrect: string[]; // clientIds who got it right
    playersIncorrect: string[]; // clientIds who got it wrong
    playersTimedOut: string[]; // clientIds who didn't answer
  };
  winnerId?: string; // clientId of winner (set in game_over phase)
};
