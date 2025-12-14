import { Client, Room } from "colyseus.js";
import * as readline from "readline";
import type { JsonValue } from "@bufbuild/protobuf";
import {
  createHelloEnvelope,
  createRoomJoinEnvelope,
  createGameEventEnvelopeWithJson,
  ClientKind,
  StateUpdateSchema,
  defaultJSONEnvelopeBuilder,
} from "@dialingames/partykit-protocol";
import { TriviaState } from "./types";

class PlayerClient {
  private client: Client;
  private room?: Room;
  private roomName: string;
  private playerName: string;
  private clientId?: string;
  private state: TriviaState | null = null;
  private rl: readline.Interface;
  private isWaitingForInput = false;
  private readonly envelopeBuilder = defaultJSONEnvelopeBuilder;

  constructor() {
    this.client = new Client("ws://localhost:2567");
    this.roomName = "";
    this.playerName = "";
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async start() {
    await this.showEntryScreen();
  }

  private async showEntryScreen() {
    console.clear();
    console.log("╔════════════════════════════════════════╗");
    console.log("║    TRIVIA GAME - PLAYER                ║");
    console.log("╚════════════════════════════════════════╝");
    console.log();

    this.roomName =
      (await this.prompt("Enter room ID (default: partykit): ")) || "partykit";
    this.playerName = await this.prompt("Enter your name: ");

    if (!this.playerName) {
      this.playerName = `Player${Math.floor(Math.random() * 1000)}`;
    }

    console.log();
    console.log(`Connecting as ${this.playerName}...`);
    await this.connect();
  }

  private async connect() {
    try {
      // Join the Colyseus room
      this.room = await this.client.joinOrCreate(this.roomName);
      console.log(`Connected to room ${this.room.roomId}`);

      // Send PartyKit hello message
      this.sendHello();

      // Set up message handlers
      this.room.onMessage("partykit/hello/ok", (payload) => {
        this.sendRoomJoin();
      });

      this.room.onMessage("partykit/self", (payload) => {
        this.handleSelf(payload);
      });

      this.room.onMessage("partykit/room/joined", (payload) => {
        console.log("✓ Joined room successfully!");
      });

      this.room.onMessage("partykit/state", (payload) => {
        this.handleStateUpdate(payload);
      });

      this.room.onMessage("partykit/presence", (payload) => {
        // Presence updates - state will follow
      });

      this.room.onMessage("partykit/error", (payload) => {
        console.error("Server error:", payload);
      });

      this.room.onLeave((code) => {
        console.log("\nDisconnected from server");
        this.cleanup();
      });

      this.room.onError((code, message) => {
        console.error(`Room error ${code}: ${message}`);
        this.cleanup();
      });
    } catch (e) {
      console.error("Failed to connect:", e);
      this.cleanup();
    }
  }

  private sendHello() {
    const envelope = createHelloEnvelope(
      {
        clientKind: ClientKind.CONTROLLER,
        clientName: this.playerName,
        engine: "Node",
        engineVersion: process.version,
        sdk: "partykit-colyseus",
        sdkVersion: "1.0.0",
        room: this.room!.roomId,
        from: this.playerName,
      },
      this.envelopeBuilder
    );

    this.room!.send("partykit/hello", envelope);
  }

  private sendRoomJoin() {
    const envelope = createRoomJoinEnvelope(
      {
        room: this.room!.roomId,
        from: this.clientId || this.playerName,
      },
      this.envelopeBuilder
    );

    this.room!.send("partykit/room/join", envelope);
  }

  private sendPlayerReady() {
    const envelope = createGameEventEnvelopeWithJson(
      "player_ready",
      {},
      this.room!.roomId,
      this.clientId || this.playerName,
      this.envelopeBuilder
    );

    this.room!.send("game/event", envelope);
  }

  private sendAnswer(optionIndex: number) {
    const envelope = createGameEventEnvelopeWithJson(
      "submit_answer",
      { optionIndex },
      this.room!.roomId,
      this.clientId || this.playerName,
      this.envelopeBuilder
    );

    this.room!.send("game/event", envelope);
  }

  private handleSelf(payload: JsonValue) {
    try {
      const envelope = this.envelopeBuilder.decode(payload);
      // Extract clientId from self message if available
      if (envelope.from) {
        this.clientId = envelope.from;
      }
    } catch (err) {
      console.error("Error handling self message:", err);
    }
  }

  private handleStateUpdate(payload: JsonValue) {
    try {
      const unpacked = this.envelopeBuilder.decodeAndUnpack(
        payload,
        StateUpdateSchema
      );

      if (!unpacked || !unpacked.data.state) return;

      const stateJson = new TextDecoder().decode(unpacked.data.state);
      this.state = JSON.parse(stateJson);

      this.render();
    } catch (err) {
      console.error("Error handling state update:", err);
    }
  }

  private render() {
    if (!this.state) return;

    console.clear();

    switch (this.state.phase) {
      case "lobby":
        this.renderLobby();
        break;
      case "question":
        this.renderQuestion();
        break;
      case "answer_reveal":
        this.renderAnswerReveal();
        break;
      case "game_over":
        this.renderGameOver();
        break;
    }
  }

  private renderLobby() {
    console.log("╔════════════════════════════════════════╗");
    console.log("║              LOBBY                     ║");
    console.log("╚════════════════════════════════════════╝");
    console.log();
    console.log(`  Welcome, ${this.playerName}!`);
    console.log();
    console.log("  Players in room:");

    for (const player of Object.values(this.state!.players)) {
      const readyIcon = player.isReady ? "✓" : " ";
      const isSelf = player.name === this.playerName ? " (you)" : "";
      console.log(`    [${readyIcon}] ${player.name}${isSelf}`);
    }

    console.log();

    const myPlayer = Object.values(this.state!.players).find(
      (p) => p.name === this.playerName
    );

    if (myPlayer && !myPlayer.isReady && this.state?.phase === "lobby") {
      this.promptReady();
    } else if (myPlayer && myPlayer.isReady) {
      console.log("  ✓ You are ready! Waiting for others...");
    }
  }

  private async promptReady() {
    if (this.isWaitingForInput) return;

    this.isWaitingForInput = true;
    await this.prompt("  Press Enter when ready: ");

    // Set to false before sending so incoming state updates can render
    this.isWaitingForInput = false;
    this.sendPlayerReady();
  }

  private renderQuestion() {
    const question = this.state!.questions[this.state!.currentQuestionIndex];
    const questionNum = this.state!.currentQuestionIndex + 1;
    const totalQuestions = this.state!.questions.length;

    console.log("╔════════════════════════════════════════╗");
    console.log(
      `║  Question ${questionNum}/${totalQuestions}                          ║`
    );
    console.log("╚════════════════════════════════════════╝");
    console.log();
    console.log(`  ${question.text}`);
    console.log();

    for (let i = 0; i < question.options.length; i++) {
      const num = String.fromCharCode(65 + i);
      console.log(`    ${num}) ${question.options[i]}`);
    }

    console.log();

    const myPlayer = Object.values(this.state!.players).find(
      (p) => p.name === this.playerName
    );

    if (
      myPlayer &&
      !myPlayer.currentAnswer &&
      this.state?.phase === "question" &&
      !this.isWaitingForInput
    ) {
      this.promptAnswer();
    } else if (myPlayer && myPlayer.currentAnswer) {
      const answerNum = myPlayer.currentAnswer.optionIndex + 1;
      console.log(
        `  ✓ Your answer: ${answerNum}) ${
          question.options[myPlayer.currentAnswer.optionIndex]
        }`
      );
      console.log();
      console.log("  Waiting for other players...");
    } else if (myPlayer && !myPlayer.currentAnswer && this.isWaitingForInput) {
      // Currently waiting for input - show the prompt again after clear
      console.log("  Your answer (A-D): ");
    }
  }

  private async promptAnswer() {
    if (this.isWaitingForInput) return;

    this.isWaitingForInput = true;
    const answer = await this.prompt("  Your answer (A-D): ");
    this.isWaitingForInput = false;

    const answerNum = answer.toUpperCase().charCodeAt(0) - 65;

    if (answerNum >= 0 && answerNum <= 3) {
      this.sendAnswer(answerNum);
      // Don't render here - wait for server state update
    } else {
      console.log("  Invalid answer. Please enter A-D.");
      await this.promptAnswer();
    }
  }

  private renderAnswerReveal() {
    const question = this.state!.questions[this.state!.currentQuestionIndex];
    const results = this.state!.lastQuestionResults!;
    const correctNum = results.correctAnswer + 1;
    const correctAnswer = question.options[results.correctAnswer];

    console.log("╔════════════════════════════════════════╗");
    console.log("║          ANSWER REVEAL                 ║");
    console.log("╚════════════════════════════════════════╝");
    console.log();
    console.log(`  ✓ Correct Answer: ${correctNum}) ${correctAnswer}`);
    console.log();

    const myPlayer = Object.values(this.state!.players).find(
      (p) => p.name === this.playerName
    );

    if (myPlayer) {
      const myClientId = Object.keys(this.state!.players).find(
        (id) => this.state!.players[id].name === this.playerName
      );

      if (myClientId && results.playersCorrect.includes(myClientId)) {
        console.log("  🎉 CORRECT! You earned 1 point!");
      } else if (myClientId && results.playersIncorrect.includes(myClientId)) {
        console.log("  ✗ Incorrect. Better luck next time!");
      } else if (myClientId && results.playersTimedOut.includes(myClientId)) {
        console.log("  ⏱ Time's up! You didn't answer.");
      }

      console.log();
      console.log(`  Your score: ${myPlayer.score} points`);
    }

    console.log();
    console.log("  Watch the display for the next question...");
  }

  private renderGameOver() {
    console.log("╔════════════════════════════════════════╗");
    console.log("║            GAME OVER!                  ║");
    console.log("╚════════════════════════════════════════╝");
    console.log();

    const winner = this.state!.winnerId
      ? this.state!.players[this.state!.winnerId]
      : null;

    const myPlayer = Object.values(this.state!.players).find(
      (p) => p.name === this.playerName
    );

    if (winner && myPlayer && winner.name === myPlayer.name) {
      console.log("  🏆 YOU WON! Congratulations!");
    } else if (winner) {
      console.log(`  🏆 Winner: ${winner.name}`);
    }

    console.log();

    if (myPlayer) {
      console.log(`  Your final score: ${myPlayer.score} points`);
    }

    console.log();
    console.log("  Final Standings:");

    const sortedPlayers = Object.values(this.state!.players).sort(
      (a, b) => b.score - a.score
    );

    for (let i = 0; i < sortedPlayers.length; i++) {
      const player = sortedPlayers[i];
      const position = i + 1;
      console.log(`    ${position}. ${player.name} - ${player.score} points`);
    }

    console.log();
    console.log("  Returning to entry screen in 5 seconds...");

    setTimeout(() => {
      this.returnToEntry();
    }, 5000);
  }

  private returnToEntry() {
    this.cleanup();
    this.start();
  }

  private cleanup() {
    if (this.room) {
      this.room.leave();
      this.room = undefined;
    }
    this.state = null;
    this.clientId = undefined;
  }

  private prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }
}

// Main entry point
async function main() {
  const client = new PlayerClient();
  await client.start();

  // Handle Ctrl+C gracefully
  process.on("SIGINT", () => {
    console.log("\n\nExiting...");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
