import type { Client } from "colyseus";
import { create } from "@bufbuild/protobuf";
import { PartyKitColyseusRoom } from "@dialingames/partykit-colyseus";
import type {
  PartyKitAuthResult,
  PartyKitClientContext,
} from "@dialingames/partykit-colyseus";
import {
  ClientKind,
  Hello,
} from "@buf/dialingames_partykit.bufbuild_es/v1/connection_pb.js";
import { RoomJoin } from "@buf/dialingames_partykit.bufbuild_es/v1/room_pb.js";
import { GameEvent } from "@buf/dialingames_partykit.bufbuild_es/v1/game_pb.js";
import { Role } from "@buf/dialingames_partykit.bufbuild_es/v1/presence_pb.js";
import {
  StateUpdateSchema,
  StateUpdateKind,
} from "@buf/dialingames_partykit.bufbuild_es/v1/state_pb.js";
import type { TriviaQuestion, TriviaState } from "./types.js";

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

export class TriviaRoom extends PartyKitColyseusRoom {
  private pkState: TriviaState = {
    phase: "lobby",
    players: {},
    questions: [],
    currentQuestionIndex: -1,
    questionTimeLimit: 60,
  };

  private questionTimer?: NodeJS.Timeout;
  private disconnectionTimers = new Map<string, NodeJS.Timeout>();

  protected async authorizeHello(
    client: Client,
    hello: Hello
  ): Promise<PartyKitAuthResult> {
    const kind = (hello.client?.kind as ClientKind) ?? ClientKind.CONTROLLER;
    const isHost = kind === ClientKind.DISPLAY;

    return {
      ok: true,
      context: {
        clientId: client.sessionId,
        kind,
        displayName: hello.client?.name ?? "",
        role: isHost ? Role.HOST : Role.PLAYER,
        capabilities: isHost
          ? ["CanStartGame", "CanAdvanceRound", "CanRevealAnswers"]
          : [],
        groups: [kind == ClientKind.DISPLAY ? "host" : "player"],
        metadata: {},
      },
    };
  }

  protected async onPartyKitJoin(
    client: Client,
    ctx: PartyKitClientContext,
    join: RoomJoin
  ): Promise<void> {
    // Check if player already exists (reconnection)
    if (this.pkState.players[ctx.clientId]) {
      const player = this.pkState.players[ctx.clientId];

      // Cancel disconnection timer
      const timer = this.disconnectionTimers.get(ctx.clientId);
      if (timer) {
        clearTimeout(timer);
        this.disconnectionTimers.delete(ctx.clientId);
      }

      // Mark as reconnected
      player.isConnected = true;
      player.disconnectedAt = undefined;

      console.log(`Player ${player.name} reconnected`);
      this.broadcastStateUpdate();
    } else if (ctx.role === Role.PLAYER) {
      // New player joining
      this.pkState.players[ctx.clientId] = {
        name: ctx.displayName || "Player",
        score: 0,
        isReady: false,
        isConnected: true,
      };

      console.log(`Player ${ctx.displayName} joined`);
      this.broadcastStateUpdate();
    }
  }

  override async onLeave(client: Client, consented: boolean) {
    const ctx = this.presenceTracker.get(client.sessionId);

    if (ctx && this.pkState.players[ctx.clientId]) {
      const player = this.pkState.players[ctx.clientId];

      // Mark as disconnected
      player.isConnected = false;
      player.disconnectedAt = Date.now();

      // If in lobby and player was ready, unmark ready
      if (this.pkState.phase === "lobby" && player.isReady) {
        player.isReady = false;
      }

      console.log(
        `Player ${player.name} disconnected, starting 60s grace period`
      );

      // Start 60 second grace period
      const timer = setTimeout(() => {
        this.handlePlayerTimeout(ctx.clientId);
      }, 60000);

      this.disconnectionTimers.set(ctx.clientId, timer);

      this.broadcastStateUpdate();
    }

    // Call parent onLeave
    await super.onLeave(client, consented);
  }

  protected async onPartyKitGameEvent(
    client: Client,
    ctx: PartyKitClientContext,
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

  protected async getStateSnapshot(
    _ctx: PartyKitClientContext
  ): Promise<unknown> {
    return this.pkState;
  }

  // Event Handlers

  private async handlePlayerReady(
    client: Client,
    ctx: PartyKitClientContext,
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
      // Auto-start game
      this.startGame();
    }

    // Broadcast state update
    this.broadcastStateUpdate();
  }

  private async handleSubmitAnswer(
    client: Client,
    ctx: PartyKitClientContext,
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
      // All players answered - immediately reveal answer
      console.log("All players answered! Revealing answer...");
      this.clearQuestionTimer();
      this.revealAnswer();
    }

    // Broadcast state update
    this.broadcastStateUpdate();
  }

  // Helper Methods

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
        player.score += 1; // 1 point for correct answer
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
    setTimeout(() => {
      this.advanceToNextQuestion();
    }, 5000);
  }

  private advanceToNextQuestion() {
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

      // Start 60 second timer
      this.startQuestionTimer();
    } else {
      // Game over
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

  private async broadcastStateUpdate() {
    // Increment tick and broadcast state snapshot to all clients
    this.tick++;

    // Get current state snapshot
    const snapshot = await this.getStateSnapshot({} as any);
    const encoded = new TextEncoder().encode(JSON.stringify(snapshot));

    // Create StateUpdate message
    const stateUpdate = create(StateUpdateSchema, {
      kind: StateUpdateKind.SNAPSHOT,
      tick: BigInt(this.tick),
      state: encoded,
    });

    // Broadcast to all clients
    this.broadcastEnvelope("partykit/state", stateUpdate);
  }

  private getShuffledQuestions(): TriviaQuestion[] {
    // Fisher-Yates shuffle of hardcoded questions
    const questions = [...TRIVIA_QUESTIONS];
    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }
    return questions.slice(0, 5); // Take first 5
  }

  private handlePlayerTimeout(clientId: string) {
    const player = this.pkState.players[clientId];
    if (!player) return;

    // Player didn't reconnect within 60 seconds
    console.log(
      `Player ${player.name} didn't reconnect within 60s, continuing without them`
    );

    this.disconnectionTimers.delete(clientId);
    this.broadcastStateUpdate();
  }
}
