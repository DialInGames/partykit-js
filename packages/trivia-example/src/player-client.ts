import WebSocket from "ws";
import * as readline from "readline";
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
import { GameEventSchema } from "@buf/dialingames_partykit.bufbuild_es/v1/game_pb.js";
import type { TriviaState } from "./types.js";

class PlayerClient {
  private ws!: WebSocket;
  private roomId: string;
  private playerName: string;
  private clientId?: string;
  private state: TriviaState | null = null;
  private rl: readline.Interface;
  private currentPhase: string = "entry";
  private isWaitingForInput = false;

  constructor(roomId: string = "partykit", playerName: string = "Player") {
    this.roomId = roomId;
    this.playerName = playerName;
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

    this.roomId = await this.prompt("Enter room ID (default: partykit): ") || "partykit";
    this.playerName = await this.prompt("Enter your name: ");

    if (!this.playerName) {
      this.playerName = `Player${Math.floor(Math.random() * 1000)}`;
    }

    console.log();
    console.log(`Connecting as ${this.playerName}...`);
    this.connect();
  }

  private connect() {
    const url = `ws://localhost:2567/${this.roomId}`;

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this.sendHello();
    });

    this.ws.on("message", (data: Buffer) => {
      this.handleMessage(data);
    });

    this.ws.on("close", () => {
      console.log("\nDisconnected from server");
      this.cleanup();
    });

    this.ws.on("error", (err) => {
      console.error("WebSocket error:", err);
      this.cleanup();
    });
  }

  private sendHello() {
    const hello = create(HelloSchema, {
      client: create(ClientInfoSchema, {
        kind: ClientKind.CONTROLLER,
        name: this.playerName,
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

  private sendPlayerReady() {
    const gameEvent = create(GameEventSchema, {
      name: "player_ready",
      payload: new Uint8Array(),
    });

    const envelope = this.createEnvelope("game/event", gameEvent, GameEventSchema);
    this.sendMessage("game/event", envelope);
  }

  private sendAnswer(optionIndex: number) {
    const answerData = JSON.stringify({ optionIndex });
    const gameEvent = create(GameEventSchema, {
      name: "submit_answer",
      payload: new TextEncoder().encode(answerData),
    });

    const envelope = this.createEnvelope("game/event", gameEvent, GameEventSchema);
    this.sendMessage("game/event", envelope);
  }

  private createEnvelope(type: string, payload: any, schema: any): Uint8Array {
    const envelope = create(EnvelopeSchema, {
      v: 1,
      t: type,
      id: this.generateMessageId(),
      replyTo: "",
      ts: BigInt(Date.now()),
      room: this.roomId,
      from: this.clientId || "player",
      to: "server",
      data: anyPack(schema, payload),
    });

    return toBinary(EnvelopeSchema, envelope);
  }

  private sendMessage(type: string, payload: Uint8Array) {
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
          this.sendRoomJoin();
          break;

        case "partykit/self":
          this.handleSelf(envelope);
          break;

        case "partykit/room/joined":
          console.log("✓ Joined room successfully!");
          this.currentPhase = "lobby";
          break;

        case "partykit/state":
          this.handleStateUpdate(envelope);
          break;

        case "partykit/presence":
          // Presence updates - state will follow
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

  private handleSelf(envelope: any) {
    // Extract clientId from self message if available
    // Note: This depends on the actual structure of the self message
    if (envelope.from) {
      this.clientId = envelope.from;
    }
  }

  private handleStateUpdate(envelope: any) {
    try {
      if (!envelope.data) return;

      const stateUpdate = anyUnpack(envelope.data, StateUpdateSchema);
      if (!stateUpdate || !stateUpdate.state) return;

      const stateJson = new TextDecoder().decode(stateUpdate.state);
      this.state = JSON.parse(stateJson);

      this.render();
    } catch (err) {
      console.error("Error handling state update:", err);
    }
  }

  private render() {
    if (!this.state) return;

    // Don't re-render if waiting for input
    if (this.isWaitingForInput) return;

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

    if (myPlayer && !myPlayer.isReady && this.currentPhase === "lobby") {
      this.promptReady();
    } else if (myPlayer && myPlayer.isReady) {
      console.log("  ✓ You are ready! Waiting for others...");
    }
  }

  private async promptReady() {
    if (this.isWaitingForInput) return;

    this.isWaitingForInput = true;
    await this.prompt("  Press Enter when ready: ");
    this.isWaitingForInput = false;

    this.sendPlayerReady();
    this.render();
  }

  private renderQuestion() {
    const question = this.state!.questions[this.state!.currentQuestionIndex];
    const questionNum = this.state!.currentQuestionIndex + 1;
    const totalQuestions = this.state!.questions.length;

    console.log("╔════════════════════════════════════════╗");
    console.log(`║  Question ${questionNum}/${totalQuestions}                          ║`);
    console.log("╚════════════════════════════════════════╝");
    console.log();
    console.log(`  ${question.text}`);
    console.log();

    for (let i = 0; i < question.options.length; i++) {
      const num = i + 1;
      console.log(`    ${num}) ${question.options[i]}`);
    }

    console.log();

    const myPlayer = Object.values(this.state!.players).find(
      (p) => p.name === this.playerName
    );

    if (myPlayer && !myPlayer.currentAnswer && this.currentPhase === "question") {
      this.promptAnswer();
    } else if (myPlayer && myPlayer.currentAnswer) {
      const answerNum = myPlayer.currentAnswer.optionIndex + 1;
      console.log(`  ✓ Your answer: ${answerNum}) ${question.options[myPlayer.currentAnswer.optionIndex]}`);
      console.log();
      console.log("  Waiting for other players...");
      this.currentPhase = "waiting";
    }
  }

  private async promptAnswer() {
    if (this.isWaitingForInput) return;

    this.isWaitingForInput = true;
    const answer = await this.prompt("  Your answer (1-4): ");
    this.isWaitingForInput = false;

    const answerNum = parseInt(answer);

    if (answerNum >= 1 && answerNum <= 4) {
      this.sendAnswer(answerNum - 1);
      this.currentPhase = "waiting";
      this.render();
    } else {
      console.log("  Invalid answer. Please enter 1-4.");
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

    this.currentPhase = "answer_reveal";
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
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
    }
    this.state = null;
    this.clientId = undefined;
    this.currentPhase = "entry";
  }

  private prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
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
