import { Client, Room } from "colyseus.js";
import type { JsonValue } from "@bufbuild/protobuf";
import {
  createHelloEnvelope,
  createRoomJoinEnvelope,
  ClientKind,
  StateUpdateSchema,
  defaultJSONEnvelopeBuilder,
} from "@dialingames/partykit-protocol";
import type { TriviaState } from "./types.js";

class HostClient {
  private client: Client;
  private room?: Room;
  private roomName: string;
  private state: TriviaState | null = null;
  private renderInterval?: NodeJS.Timeout;
  private readonly envelopeBuilder = defaultJSONEnvelopeBuilder;

  constructor(roomName: string = "partykit") {
    this.roomName = roomName;
    this.client = new Client("ws://localhost:2567");
  }

  async start() {
    console.log("Starting host client...");
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
        console.log("Hello acknowledged, joining room...");
        this.sendRoomJoin();
      });

      this.room.onMessage("partykit/room/joined", (payload) => {
        console.log("Joined room successfully!");
        this.startRendering();
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
        console.log(`\nLeft room with code ${code}`);
        if (this.renderInterval) {
          clearInterval(this.renderInterval);
        }
        process.exit(0);
      });

      this.room.onError((code, message) => {
        console.error(`Room error ${code}: ${message}`);
        process.exit(1);
      });
    } catch (e) {
      console.error("Failed to connect:", e);
      process.exit(1);
    }
  }

  private sendHello() {
    const envelope = createHelloEnvelope(
      {
        clientKind: ClientKind.DISPLAY,
        clientName: "Host",
        engine: "Node",
        engineVersion: process.version,
        sdk: "partykit-colyseus",
        sdkVersion: "1.0.0",
        room: this.room!.roomId,
        from: "host",
      },
      this.envelopeBuilder
    );

    this.room!.send("partykit/hello", envelope);
  }

  private sendRoomJoin() {
    const envelope = createRoomJoinEnvelope(
      {
        room: this.room!.roomId,
        from: "host",
      },
      this.envelopeBuilder
    );

    this.room!.send("partykit/room/join", envelope);
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

  private startRendering() {
    // Render every second to update timer
    this.renderInterval = setInterval(() => {
      if (this.state?.phase === "question") {
        this.render();
      }
    }, 1000);

    this.render();
  }

  private render() {
    if (!this.state) {
      console.clear();
      console.log("Waiting for game state...");
      return;
    }

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
    console.log("║         TRIVIA GAME - LOBBY            ║");
    console.log("╚════════════════════════════════════════╝");
    console.log();
    console.log(`  Room: ${this.room!.roomId}`);
    console.log();

    const playerList = Object.values(this.state!.players);

    if (playerList.length === 0) {
      console.log("  Waiting for players to join...");
    } else {
      console.log("  Players:");
      for (const player of playerList) {
        const readyIcon = player.isReady ? "✓" : " ";
        const connIcon = player.isConnected ? "●" : "○";
        console.log(`    [${readyIcon}] ${connIcon} ${player.name}`);
      }

      console.log();
      const allReady = playerList.every((p) => p.isReady || !p.isConnected);
      if (allReady && playerList.length > 0) {
        console.log("  🎮 Game starting...");
      } else {
        console.log("  Waiting for all players to ready up...");
      }
    }
  }

  private renderQuestion() {
    const question = this.state!.questions[this.state!.currentQuestionIndex];
    const questionNum = this.state!.currentQuestionIndex + 1;
    const totalQuestions = this.state!.questions.length;

    // Calculate remaining time
    const elapsed = (Date.now() - this.state!.questionStartTime!) / 1000;
    const remaining = Math.max(0, this.state!.questionTimeLimit - elapsed);

    console.log("╔════════════════════════════════════════╗");
    console.log(
      `║  Question ${questionNum}/${totalQuestions}            Time: ${Math.ceil(
        remaining
      )}s  ║`
    );
    console.log("╚════════════════════════════════════════╝");
    console.log();
    console.log(`  ${question.text}`);
    console.log();

    for (let i = 0; i < question.options.length; i++) {
      const letter = String.fromCharCode(65 + i); // A, B, C, D
      console.log(`    ${letter}) ${question.options[i]}`);
    }

    console.log();
    console.log("  Player Status:");

    for (const [clientId, player] of Object.entries(this.state!.players)) {
      if (!player.isConnected) continue;

      const status = player.currentAnswer ? "✓ Answered" : "⏳ Thinking...";
      console.log(`    ${player.name}: ${status}`);
    }
  }

  private renderAnswerReveal() {
    const question = this.state!.questions[this.state!.currentQuestionIndex];
    const results = this.state!.lastQuestionResults!;
    const correctLetter = String.fromCharCode(65 + results.correctAnswer);
    const correctAnswer = question.options[results.correctAnswer];

    console.log("╔════════════════════════════════════════╗");
    console.log("║          ANSWER REVEAL                 ║");
    console.log("╚════════════════════════════════════════╝");
    console.log();
    console.log(`  ✓ Correct Answer: ${correctLetter}) ${correctAnswer}`);
    console.log();

    console.log("  Results:");
    console.log();

    if (results.playersCorrect.length > 0) {
      console.log("    ✓ CORRECT:");
      for (const clientId of results.playersCorrect) {
        const player = this.state!.players[clientId];
        console.log(`      • ${player.name} (+1 point)`);
      }
      console.log();
    }

    if (results.playersIncorrect.length > 0) {
      console.log("    ✗ INCORRECT:");
      for (const clientId of results.playersIncorrect) {
        const player = this.state!.players[clientId];
        console.log(`      • ${player.name}`);
      }
      console.log();
    }

    if (results.playersTimedOut.length > 0) {
      console.log("    ⏱ TIMED OUT:");
      for (const clientId of results.playersTimedOut) {
        const player = this.state!.players[clientId];
        console.log(`      • ${player.name}`);
      }
      console.log();
    }

    console.log("  Current Scores:");
    const sortedPlayers = Object.values(this.state!.players).sort(
      (a, b) => b.score - a.score
    );
    for (const player of sortedPlayers) {
      console.log(`    ${player.name}: ${player.score} points`);
    }

    console.log();
    console.log("  Advancing to next question...");
  }

  private renderGameOver() {
    console.log("╔════════════════════════════════════════╗");
    console.log("║            GAME OVER!                  ║");
    console.log("╚════════════════════════════════════════╝");
    console.log();

    const winner = this.state!.winnerId
      ? this.state!.players[this.state!.winnerId]
      : null;

    if (winner) {
      console.log(`  🏆 WINNER: ${winner.name}`);
      console.log(`     Score: ${winner.score} points`);
    } else {
      console.log("  No winner!");
    }

    console.log();
    console.log("  Final Scores:");

    const sortedPlayers = Object.values(this.state!.players).sort(
      (a, b) => b.score - a.score
    );

    for (let i = 0; i < sortedPlayers.length; i++) {
      const player = sortedPlayers[i];
      const position = i + 1;
      console.log(`    ${position}. ${player.name} - ${player.score} points`);
    }

    console.log();
    console.log("  Thanks for playing!");
  }
}

// Main entry point
async function main() {
  const roomName = process.argv[2] || "partykit";
  const client = new HostClient(roomName);
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
