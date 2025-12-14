import WebSocket from "ws";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import { anyUnpack, anyPack } from "@bufbuild/protobuf/wkt";
import {
  ClientKind,
  ClientInfoSchema,
  HelloSchema,
} from "@buf/dialingames_partykit.bufbuild_es/v1/connection_pb.js";
import { RoomJoinSchema } from "@buf/dialingames_partykit.bufbuild_es/v1/room_pb.js";
import { EnvelopeSchema } from "@buf/dialingames_partykit.bufbuild_es/v1/envelope_pb.js";
import { StateUpdateSchema } from "@buf/dialingames_partykit.bufbuild_es/v1/state_pb.js";
import type { TriviaState } from "./types.js";

class DisplayClient {
  private ws!: WebSocket;
  private roomId: string;
  private state: TriviaState | null = null;
  private renderInterval?: NodeJS.Timeout;

  constructor(roomId: string = "partykit") {
    this.roomId = roomId;
  }

  async start() {
    console.log("Starting display client...");
    this.connect();
  }

  private connect() {
    const url = `ws://localhost:2567/${this.roomId}`;
    console.log(`Connecting to ${url}...`);

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log("WebSocket connected");
      this.sendHello();
    });

    this.ws.on("message", (data: Buffer) => {
      this.handleMessage(data);
    });

    this.ws.on("close", () => {
      console.log("\nDisconnected from server");
      if (this.renderInterval) {
        clearInterval(this.renderInterval);
      }
      process.exit(0);
    });

    this.ws.on("error", (err) => {
      console.error("WebSocket error:", err);
      process.exit(1);
    });
  }

  private sendHello() {
    const hello = create(HelloSchema, {
      client: create(ClientInfoSchema, {
        kind: ClientKind.DISPLAY,
        name: "Display",
        engine: "Node",
        engineVersion: process.version,
        sdk: "partykit-colyseus",
        sdkVersion: "1.0.0",
      }),
    });

    const envelope = this.createEnvelope("partykit/hello", hello, HelloSchema);
    this.sendMessage("partykit/hello", envelope);
  }

  private sendRoomJoin() {
    const join = create(RoomJoinSchema, {});
    const envelope = this.createEnvelope("partykit/room/join", join, RoomJoinSchema);
    this.sendMessage("partykit/room/join", envelope);
  }

  private createEnvelope(type: string, payload: any, schema: any): Uint8Array {
    const envelope = create(EnvelopeSchema, {
      v: 1,
      t: type,
      id: this.generateMessageId(),
      replyTo: "",
      ts: BigInt(Date.now()),
      room: this.roomId,
      from: "display",
      to: "server",
      data: anyPack(schema, payload),
    });

    // Serialize the envelope
    return toBinary(EnvelopeSchema, envelope);
  }

  private sendMessage(type: string, payload: Uint8Array) {
    // Colyseus message format: [type, payload]
    const message = JSON.stringify([type, Array.from(payload)]);
    this.ws.send(message);
  }

  private handleMessage(data: Buffer) {
    try {
      const parsed = JSON.parse(data.toString());

      if (Array.isArray(parsed) && parsed.length === 2) {
        const [type, payloadArray] = parsed;
        const payload = new Uint8Array(payloadArray);

        this.handleEnvelope(type, payload);
      }
    } catch (err) {
      console.error("Error handling message:", err);
    }
  }

  private handleEnvelope(type: string, payload: Uint8Array) {
    try {
      const envelope = fromBinary(EnvelopeSchema, payload);

      switch (type) {
        case "partykit/hello/ok":
          console.log("Hello acknowledged, joining room...");
          this.sendRoomJoin();
          break;

        case "partykit/room/joined":
          console.log("Joined room successfully!");
          this.startRendering();
          break;

        case "partykit/state":
          this.handleStateUpdate(envelope);
          break;

        case "partykit/presence":
          // Player joined/left - state update will follow
          break;

        case "partykit/error":
          console.error("Server error:", envelope);
          break;

        default:
          // Ignore unknown message types
          break;
      }
    } catch (err) {
      console.error("Error parsing envelope:", err);
    }
  }

  private handleStateUpdate(envelope: any) {
    try {
      if (!envelope.data) return;

      // Unpack StateUpdate message
      const stateUpdate = anyUnpack(envelope.data, StateUpdateSchema);
      if (!stateUpdate || !stateUpdate.state) return;

      // Decode JSON state
      const stateJson = new TextDecoder().decode(stateUpdate.state);
      this.state = JSON.parse(stateJson);

      // Render immediately
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
    console.log(`  Room: ${this.roomId}`);
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
      `║  Question ${questionNum}/${totalQuestions}            Time: ${Math.ceil(remaining)}s  ║`
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

  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
}

// Main entry point
async function main() {
  const roomId = process.argv[2] || "partykit";
  const client = new DisplayClient(roomId);
  await client.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
