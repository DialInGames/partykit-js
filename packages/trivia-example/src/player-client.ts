import { Client, Room } from "colyseus.js";
import * as readline from "readline";
import { create, toJson, fromJson, type JsonValue, createRegistry } from "@bufbuild/protobuf";
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
  private client: Client;
  private room?: Room;
  private roomName: string;
  private playerName: string;
  private clientId?: string;
  private state: TriviaState | null = null;
  private rl: readline.Interface;
  private currentPhase: string = "entry";
  private isWaitingForInput = false;
  private readonly registry = createRegistry(
    HelloSchema,
    RoomJoinSchema,
    StateUpdateSchema,
    GameEventSchema,
    EnvelopeSchema
  );

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

    this.roomName = (await this.prompt("Enter room ID (default: partykit): ")) || "partykit";
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
        this.currentPhase = "lobby";
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

    const envelope = create(EnvelopeSchema, {
      v: 1,
      t: "partykit/hello",
      id: this.generateMessageId(),
      replyTo: "",
      ts: BigInt(Date.now()),
      room: this.room!.roomId,
      from: this.playerName,
      to: "server",
      data: anyPack(HelloSchema, hello),
    });

    this.room!.send("partykit/hello", toJson(EnvelopeSchema, envelope, { registry: this.registry }));
  }

  private sendRoomJoin() {
    const join = create(RoomJoinSchema, {});

    const envelope = create(EnvelopeSchema, {
      v: 1,
      t: "partykit/room/join",
      id: this.generateMessageId(),
      replyTo: "",
      ts: BigInt(Date.now()),
      room: this.room!.roomId,
      from: this.clientId || this.playerName,
      to: "server",
      data: anyPack(RoomJoinSchema, join),
    });

    this.room!.send("partykit/room/join", toJson(EnvelopeSchema, envelope, { registry: this.registry }));
  }

  private sendPlayerReady() {
    const gameEvent = create(GameEventSchema, {
      name: "player_ready",
      payload: new Uint8Array(),
    });

    const envelope = create(EnvelopeSchema, {
      v: 1,
      t: "game/event",
      id: this.generateMessageId(),
      replyTo: "",
      ts: BigInt(Date.now()),
      room: this.room!.roomId,
      from: this.clientId || this.playerName,
      to: "server",
      data: anyPack(GameEventSchema, gameEvent),
    });

    this.room!.send("game/event", toJson(EnvelopeSchema, envelope, { registry: this.registry }));
  }

  private sendAnswer(optionIndex: number) {
    const answerData = JSON.stringify({ optionIndex });
    const gameEvent = create(GameEventSchema, {
      name: "submit_answer",
      payload: new TextEncoder().encode(answerData),
    });

    const envelope = create(EnvelopeSchema, {
      v: 1,
      t: "game/event",
      id: this.generateMessageId(),
      replyTo: "",
      ts: BigInt(Date.now()),
      room: this.room!.roomId,
      from: this.clientId || this.playerName,
      to: "server",
      data: anyPack(GameEventSchema, gameEvent),
    });

    this.room!.send("game/event", toJson(EnvelopeSchema, envelope, { registry: this.registry }));
  }

  private handleSelf(payload: JsonValue) {
    try {
      const envelope = fromJson(EnvelopeSchema, payload, { registry: this.registry });
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
      const envelope = fromJson(EnvelopeSchema, payload, { registry: this.registry });
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
    if (this.room) {
      this.room.leave();
      this.room = undefined;
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
