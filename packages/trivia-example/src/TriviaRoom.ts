import type { Client } from "colyseus";
import { PartyKitColyseusRoom } from "@dialingames/partykit-colyseus";
import type { PartyKitAuthResult } from "@dialingames/partykit-colyseus";
import { Hello } from "@buf/dialingames_partykit.bufbuild_es/v1/connection_pb.js";
import { RoomJoin } from "@buf/dialingames_partykit.bufbuild_es/v1/room_pb.js";
import { GameEvent } from "@buf/dialingames_partykit.bufbuild_es/v1/game_pb.js";
import { Role } from "@buf/dialingames_partykit.bufbuild_es/v1/presence_pb.js";

type TriviaState = {
  phase: "lobby" | "question" | "results";
  players: Record<string, { name: string; score: number }>;
};

export class TriviaRoom extends PartyKitColyseusRoom {
  private pkState: TriviaState = { phase: "lobby", players: {} };

  protected async authorizeHello(
    client: Client,
    hello: Hello
  ): Promise<PartyKitAuthResult> {
    // Minimal: accept everyone; assign display as host only if you want.
    const kind = (hello.client?.kind as any) ?? "controller";

    const isHost = kind === "display";

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
        groups: [kind],
        metadata: {},
      },
    };
  }

  protected async onPartyKitJoin(
    client: Client,
    ctx: any,
    join: RoomJoin
  ): Promise<void> {
    if (ctx.role === "player") {
      this.pkState.players[ctx.clientId] = {
        name: ctx.displayName || "Player",
        score: 0,
      };
    }
  }

  protected async onPartyKitGameEvent(
    client: Client,
    ctx: any,
    ev: GameEvent
  ): Promise<void> {
    if (ev.name === "start_game") {
      if (!ctx.capabilities.includes("CanStartGame"))
        throw new Error("unauthorized");
      this.pkState.phase = "question";
    }
  }

  protected async getStateSnapshot(_ctx: any): Promise<unknown> {
    return this.pkState;
  }
}
