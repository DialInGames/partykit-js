import type { Client } from "colyseus";
import { create } from "@bufbuild/protobuf";
import {
  PartyKitColyseusRoom,
  type Session,
} from "@dialingames/partykit-colyseus";
import type { PartyKitAuthResult } from "@dialingames/partykit-colyseus";
import {
  ClientKind,
  type Hello,
  type RoomJoin,
  type GameEvent,
  Role,
  StateUpdateSchema,
  StateUpdateKind,
  ClientContextSchema,
  ClientContext,
} from "@dialingames/partykit-protocol";
import type { TriviaQuestion, TriviaState, PlayerState } from "./types.js";

// Hardcoded trivia questions - at least 7 so we can randomly select 5
const TRIVIA_QUESTIONS: TriviaQuestion[] = [
  {
    text: "What is the capital of France?",
    options: ["London", "Berlin", "Paris", "Madrid"],
    correctAnswer: 2,
  },
  {
    text: "What is 2 + 2?",
    options: ["3", "4", "5", "6"],
    correctAnswer: 1,
  },
  {
    text: "What color is the sky on a clear day?",
    options: ["Green", "Blue", "Red", "Yellow"],
    correctAnswer: 1,
  },
  {
    text: "How many continents are there?",
    options: ["5", "6", "7", "8"],
    correctAnswer: 2,
  },
  {
    text: "What is the largest planet in our solar system?",
    options: ["Earth", "Mars", "Jupiter", "Saturn"],
    correctAnswer: 2,
  },
  {
    text: "What year did World War II end?",
    options: ["1943", "1944", "1945", "1946"],
    correctAnswer: 2,
  },
  {
    text: "What is the smallest prime number?",
    options: ["0", "1", "2", "3"],
    correctAnswer: 2,
  },
];

export class TriviaRoom extends PartyKitColyseusRoom<PlayerState> {
  private pkState: TriviaState = {
    phase: "lobby",
    players: {},
    questions: [],
    currentQuestionIndex: -1,
    questionTimeLimit: 60,
  };

  private questionTimer?: NodeJS.Timeout;
  private advanceTimer?: NodeJS.Timeout;

  protected async authorizeHello(
    client: Client,
    hello: Hello
  ): Promise<PartyKitAuthResult> {
    const kind = (hello.client?.kind as ClientKind) ?? ClientKind.CONTROLLER;
    const isHost = kind === ClientKind.DISPLAY;

    return {
      ok: true,
      context: create(ClientContextSchema, {
        clientId: client.sessionId,
        kind,
        displayName: hello.client?.name ?? "",
        role: isHost ? Role.HOST : Role.PLAYER,
        capabilities: isHost
          ? ["CanStartGame", "CanAdvanceRound", "CanRevealAnswers"]
          : [],
        groups: [kind == ClientKind.DISPLAY ? "host" : "player"],
        metadata: {},
      }),
    };
  }

  protected override async onPartyKitJoin(
    client: Client,
    ctx: ClientContext,
    join: RoomJoin
  ): Promise<void> {
    // Only handle players (not hosts)
    if (ctx.role !== Role.PLAYER) {
      return;
    }

    // Always call sessionManager.connect() to properly handle both new and reconnecting clients
    const { session, isReconnect } = await this.sessionManager.connect(
      ctx.clientId,
      ctx
    );

    if (isReconnect && session.data) {
      // Reconnection - restore player from session data
      // The onSessionConnected hook has already set isConnected=true,
      // so we preserve the current connection state
      const currentPlayer = this.pkState.players[ctx.clientId];
      this.pkState.players[ctx.clientId] = {
        ...session.data,
        isConnected: currentPlayer?.isConnected ?? true,
        disconnectedAt: currentPlayer?.disconnectedAt,
      };
      console.log(`Player ${session.data.name} reconnected`);
    } else {
      // New player - create initial state
      const playerData: PlayerState = {
        name: ctx.displayName || "Player",
        score: 0,
        isReady: false,
        isConnected: true,
      };
      this.pkState.players[ctx.clientId] = playerData;

      // Store player data in session
      session.data = playerData;

      console.log(`Player ${ctx.displayName} joined`);
    }

    this.broadcastStateUpdate();
  }

  // -----------------------
  // Session Manager Hooks
  // -----------------------

  protected override async onSessionConnected(
    clientId: string,
    _session: Session<PlayerState>,
    isReconnect: boolean
  ): Promise<void> {
    const player = this.pkState.players[clientId];
    if (!player) return;

    // Update player connection state
    player.isConnected = true;
    player.disconnectedAt = undefined;

    if (isReconnect) {
      console.log(`Player ${player.name} reconnected`);

      // If we're in waiting_for_reconnection phase, check if we can resume
      if (
        this.pkState.phase === "waiting_for_reconnection" &&
        this.pkState.waitingForPlayers
      ) {
        // Remove this player from waiting list
        this.pkState.waitingForPlayers = this.pkState.waitingForPlayers.filter(
          (id) => id !== clientId
        );

        // If no more players to wait for, resume the game
        if (this.pkState.waitingForPlayers.length === 0) {
          console.log("All players reconnected, resuming game");
          this.resumeGame();
        }
      }

      this.broadcastStateUpdate();
    }
  }

  protected override async onSessionDisconnected(
    clientId: string,
    _session: Session<PlayerState>
  ): Promise<void> {
    const player = this.pkState.players[clientId];
    if (!player) return;

    // Mark as disconnected
    player.isConnected = false;
    player.disconnectedAt = Date.now();

    // If in lobby and player was ready, unmark ready
    if (this.pkState.phase === "lobby" && player.isReady) {
      player.isReady = false;
    }

    // If in active game (question or answer_reveal), enter waiting phase
    if (
      this.pkState.phase === "question" ||
      this.pkState.phase === "answer_reveal"
    ) {
      console.log(
        `Player ${player.name} disconnected during active game, entering waiting phase`
      );

      // Multiple players still active - enter waiting phase
      this.pkState.previousPhase = this.pkState.phase;
      this.pkState.phase = "waiting_for_reconnection";
      this.pkState.waitingForPlayers = [clientId];

      this.clearQuestionTimer(); // Pause question timer
      this.clearAdvanceTimer(); // Pause advance timer
    }

    console.log(`Player ${player.name} disconnected, starting grace period`);
    this.broadcastStateUpdate();
  }

  protected override async onSessionTimeout(
    clientId: string,
    _session: Session<PlayerState>
  ): Promise<void> {
    const player = this.pkState.players[clientId];
    if (!player) return;

    console.log(
      `Player ${player.name} didn't reconnect within grace period, continuing without them`
    );

    // Note: We don't remove the player from pkState.players
    // They remain in the game as disconnected

    // If we're in waiting_for_reconnection phase, check if we can continue
    if (
      this.pkState.phase === "waiting_for_reconnection" &&
      this.pkState.waitingForPlayers
    ) {
      // Remove this player from waiting list
      this.pkState.waitingForPlayers = this.pkState.waitingForPlayers.filter(
        (id) => id !== clientId
      );

      // Check if only 1 active player remains
      const activePlayers = this.getActivePlayers();
      if (activePlayers.length === 1) {
        // Only one player left - mark them as winner and end game
        const winnerId = activePlayers[0];
        console.log(
          `Only 1 active player remaining after timeout, ending game with winner: ${this.pkState.players[winnerId].name}`
        );
        this.pkState.winnerId = winnerId;
        this.pkState.phase = "game_over";
        this.pkState.waitingForPlayers = undefined;
      } else if (this.pkState.waitingForPlayers.length === 0) {
        // No more players to wait for, resume the game
        console.log(
          "Grace period expired, resuming game without disconnected players"
        );
        this.resumeGame();
      }
    }

    this.broadcastStateUpdate();
  }

  // -----------------------
  // Game Event Handlers
  // -----------------------

  protected async onPartyKitGameEvent(
    client: Client,
    ctx: ClientContext,
    ev: GameEvent
  ): Promise<void> {
    switch (ev.name) {
      case "player_ready":
        return this.handlePlayerReady(client, ctx, ev);
      case "submit_answer":
        return this.handleSubmitAnswer(client, ctx, ev);
      default:
        throw new Error(`Unknown event: ${ev.name}`);
    }
  }

  protected async getStateSnapshot(_: ClientContext): Promise<unknown> {
    return this.pkState;
  }

  private async handlePlayerReady(
    _client: Client,
    ctx: ClientContext,
    _ev: GameEvent
  ): Promise<void> {
    // Validate: must be in lobby phase
    if (this.pkState.phase !== "lobby") {
      throw new Error("Can only mark ready in lobby phase");
    }

    // Validate: must be a player (not display)
    if (ctx.role !== Role.PLAYER) {
      throw new Error("Only players can mark ready");
    }

    const player = this.pkState.players[ctx.clientId];
    if (!player) {
      throw new Error("Player not found");
    }

    // Mark player as ready
    player.isReady = true;
    console.log(`Player ${player.name} is ready`);

    // Check if all connected players are ready
    const allReady = Object.values(this.pkState.players).every(
      (p) => p.isReady || !p.isConnected
    );

    const playerCount = Object.keys(this.pkState.players).length;

    if (allReady && playerCount > 0) {
      console.log("All players ready! Starting game...");
      this.startGame();
    }

    this.broadcastStateUpdate();
  }

  private async handleSubmitAnswer(
    _client: Client,
    ctx: ClientContext,
    ev: GameEvent
  ): Promise<void> {
    // Validate: must be in question phase
    if (this.pkState.phase !== "question") {
      throw new Error("Can only submit answers during question phase");
    }

    // Validate: must be a player
    if (ctx.role !== Role.PLAYER) {
      throw new Error("Only players can submit answers");
    }

    const player = this.pkState.players[ctx.clientId];
    if (!player) {
      throw new Error("Player not found");
    }

    // Validate: player hasn't already answered
    if (player.currentAnswer) {
      throw new Error("Already submitted answer for this question");
    }

    // Parse answer from event payload (JSON payload)
    const answerData = JSON.parse(new TextDecoder().decode(ev.payload));
    const optionIndex = answerData.optionIndex;

    // Validate answer index
    if (optionIndex < 0 || optionIndex > 3) {
      throw new Error("Invalid answer option");
    }

    // Record answer with timestamp
    player.currentAnswer = {
      optionIndex,
      submittedAt: Date.now(),
    };

    console.log(`Player ${player.name} answered: ${optionIndex}`);

    // Check if all connected players have answered
    const allAnswered = Object.values(this.pkState.players).every(
      (p) => !p.isConnected || p.currentAnswer !== undefined
    );

    if (allAnswered) {
      console.log("All players answered! Revealing answer...");
      this.clearQuestionTimer();
      this.revealAnswer();
    }

    this.broadcastStateUpdate();
  }

  // -----------------------
  // Helper Methods
  // -----------------------

  /**
   * Get list of connected player clientIds
   */
  private getActivePlayers(): string[] {
    return Object.entries(this.pkState.players)
      .filter(([_, player]) => player.isConnected)
      .map(([clientId, _]) => clientId);
  }

  /**
   * Resume game from waiting_for_reconnection phase
   * Returns to the previous phase that was interrupted
   */
  private resumeGame() {
    const previousPhase = this.pkState.previousPhase || "question";

    this.pkState.phase = previousPhase;
    this.pkState.waitingForPlayers = undefined;
    this.pkState.previousPhase = undefined;

    if (previousPhase === "question") {
      // Restart question timer with remaining time
      // For simplicity, we'll just restart the full timer
      this.startQuestionTimer();
    } else if (previousPhase === "answer_reveal") {
      // Resume answer reveal - restart the advance timer
      this.advanceTimer = setTimeout(() => {
        this.advanceToNextQuestion();
      }, 5000);
    }

    this.broadcastStateUpdate();
  }

  // -----------------------
  // Game Flow Methods
  // -----------------------

  private startGame() {
    this.pkState.phase = "question";
    this.pkState.currentQuestionIndex = 0;
    this.pkState.questionStartTime = Date.now();
    this.pkState.questions = this.getShuffledQuestions();

    console.log("Game started! First question...");
    this.startQuestionTimer();
    this.broadcastStateUpdate();
  }

  private startQuestionTimer() {
    this.clearQuestionTimer();

    this.questionTimer = setTimeout(() => {
      if (this.pkState.phase === "question") {
        console.log("Time's up! Revealing answer...");
        this.revealAnswer();
      }
    }, 60000); // 60 seconds
  }

  private clearQuestionTimer() {
    if (this.questionTimer) {
      clearTimeout(this.questionTimer);
      this.questionTimer = undefined;
    }
  }

  private clearAdvanceTimer() {
    if (this.advanceTimer) {
      clearTimeout(this.advanceTimer);
      this.advanceTimer = undefined;
    }
  }

  private revealAnswer() {
    this.pkState.phase = "answer_reveal";

    const question = this.pkState.questions[this.pkState.currentQuestionIndex];
    const correctAnswer = question.correctAnswer;

    const playersCorrect: string[] = [];
    const playersIncorrect: string[] = [];
    const playersTimedOut: string[] = [];

    // Evaluate all player answers
    for (const [clientId, player] of Object.entries(this.pkState.players)) {
      if (!player.isConnected) continue;

      if (!player.currentAnswer) {
        playersTimedOut.push(clientId);
      } else if (player.currentAnswer.optionIndex === correctAnswer) {
        playersCorrect.push(clientId);
        player.score += 1;
        console.log(
          `Player ${player.name} got it correct! Score: ${player.score}`
        );
      } else {
        playersIncorrect.push(clientId);
        console.log(
          `Player ${player.name} got it wrong. Score: ${player.score}`
        );
      }
    }

    this.pkState.lastQuestionResults = {
      correctAnswer,
      playersCorrect,
      playersIncorrect,
      playersTimedOut,
    };

    this.clearQuestionTimer();
    this.broadcastStateUpdate();

    // Auto-advance to next question after 5 seconds
    this.advanceTimer = setTimeout(() => {
      this.advanceToNextQuestion();
    }, 5000);
  }

  private advanceToNextQuestion() {
    // Clear advance timer (already fired, but clean up reference)
    this.clearAdvanceTimer();

    // Clear last question results and player answers
    this.pkState.lastQuestionResults = undefined;
    for (const player of Object.values(this.pkState.players)) {
      player.currentAnswer = undefined;
    }

    // Check if there are more questions
    if (this.pkState.currentQuestionIndex < this.pkState.questions.length - 1) {
      // Move to next question
      this.pkState.currentQuestionIndex++;
      this.pkState.phase = "question";
      this.pkState.questionStartTime = Date.now();

      console.log(
        `Next question (${this.pkState.currentQuestionIndex + 1}/${
          this.pkState.questions.length
        })`
      );

      this.startQuestionTimer();
    } else {
      console.log("All questions answered! Game over...");
      this.endGame();
    }

    this.broadcastStateUpdate();
  }

  private endGame() {
    this.pkState.phase = "game_over";

    // Find winner (highest score)
    let maxScore = -1;
    let winnerId: string | undefined;

    for (const [clientId, player] of Object.entries(this.pkState.players)) {
      if (player.score > maxScore) {
        maxScore = player.score;
        winnerId = clientId;
      }
    }

    this.pkState.winnerId = winnerId;

    if (winnerId) {
      const winner = this.pkState.players[winnerId];
      console.log(`Winner: ${winner.name} with ${winner.score} points!`);
    }

    this.broadcastStateUpdate();
  }

  private getShuffledQuestions(): TriviaQuestion[] {
    const questions = [...TRIVIA_QUESTIONS];
    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }
    return questions.slice(0, 5);
  }
}
