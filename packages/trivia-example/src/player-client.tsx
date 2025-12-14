import React, { useState, useEffect } from "react";
import { render } from "ink";
import { Client, Room } from "colyseus.js";
import type { JsonValue } from "@bufbuild/protobuf";
import {
  createHelloEnvelope,
  createRoomJoinEnvelope,
  createGameEventEnvelopeWithJson,
  ClientKind,
  StateUpdateSchema,
  defaultJSONEnvelopeBuilder,
} from "@dialingames/partykit-protocol";
import { TriviaState } from "./types.js";
import { EntryScreen } from "./components/EntryScreen.js";
import { PlayerUI } from "./components/PlayerUI.js";

type AppState =
  | { phase: "entry" }
  | { phase: "connecting"; roomCode: string; playerName: string }
  | { phase: "connected"; roomCode: string; playerName: string };

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>({ phase: "entry" });
  const [client] = useState(() => new Client("ws://localhost:2567"));
  const [room, setRoom] = useState<Room | undefined>();
  const [gameState, setGameState] = useState<TriviaState | null>(null);
  const [clientId, setClientId] = useState<string | undefined>();

  const envelopeBuilder = defaultJSONEnvelopeBuilder;

  // Handle connection and setup
  useEffect(() => {
    if (appState.phase !== "connecting") return;

    const connect = async () => {
      try {
        // Join an existing Colyseus room (players cannot create rooms)
        const newRoom = await client.join("trivia", {
          roomId: appState.roomCode,
        });
        setRoom(newRoom);

        // Send PartyKit hello message
        const helloEnvelope = createHelloEnvelope(
          {
            clientKind: ClientKind.CONTROLLER,
            clientName: appState.playerName,
            engine: "Node",
            engineVersion: process.version,
            sdk: "partykit-colyseus",
            sdkVersion: "1.0.0",
            room: newRoom.roomId,
            from: appState.playerName,
          },
          envelopeBuilder
        );

        newRoom.send("partykit/hello", helloEnvelope);

        // Set up message handlers
        newRoom.onMessage("partykit/hello/ok", () => {
          // Send room join
          const joinEnvelope = createRoomJoinEnvelope(
            {
              room: newRoom.roomId,
              from: clientId || appState.playerName,
            },
            envelopeBuilder
          );
          newRoom.send("partykit/room/join", joinEnvelope);
        });

        newRoom.onMessage("partykit/self", (payload: JsonValue) => {
          try {
            const envelope = envelopeBuilder.decode(payload);
            if (envelope.from) {
              setClientId(envelope.from);
            }
          } catch (err) {
            console.error("Error handling self message:", err);
          }
        });

        newRoom.onMessage("partykit/room/joined", () => {
          setAppState({
            phase: "connected",
            roomCode: appState.roomCode,
            playerName: appState.playerName,
          });
        });

        newRoom.onMessage("partykit/state", (payload: JsonValue) => {
          try {
            const unpacked = envelopeBuilder.decodeAndUnpack(
              payload,
              StateUpdateSchema
            );

            if (!unpacked || !unpacked.data.state) return;

            const stateJson = new TextDecoder().decode(unpacked.data.state);
            const newState = JSON.parse(stateJson) as TriviaState;
            setGameState(newState);

            // Handle game over - return to entry after delay
            if (newState.phase === "game_over") {
              setTimeout(() => {
                newRoom.leave();
                setRoom(undefined);
                setGameState(null);
                setClientId(undefined);
                setAppState({ phase: "entry" });
              }, 5000);
            }
          } catch (err) {
            console.error("Error handling state update:", err);
          }
        });

        newRoom.onMessage("partykit/presence", () => {
          // Presence updates - state will follow
        });

        newRoom.onMessage("partykit/error", (payload: JsonValue) => {
          console.error("Server error:", payload);
        });

        newRoom.onLeave(() => {
          setRoom(undefined);
          setGameState(null);
          setClientId(undefined);
          setAppState({ phase: "entry" });
        });

        newRoom.onError((code: number, message?: string) => {
          console.error(`Room error ${code}: ${message}`);
          setRoom(undefined);
          setAppState({ phase: "entry" });
        });
      } catch (e) {
        console.error("Failed to connect:", e);
        setAppState({ phase: "entry" });
      }
    };

    connect();
  }, [appState, client, clientId, envelopeBuilder]);

  const handleEntrySubmit = (roomCode: string, playerName: string) => {
    setAppState({ phase: "connecting", roomCode: roomCode, playerName });
  };

  const handleReady = () => {
    if (!room) return;

    const envelope = createGameEventEnvelopeWithJson(
      "player_ready",
      {},
      room.roomId,
      clientId || (appState.phase !== "entry" ? appState.playerName : ""),
      envelopeBuilder
    );

    room.send("game/event", envelope);
  };

  const handleAnswer = (optionIndex: number) => {
    if (!room) return;

    const envelope = createGameEventEnvelopeWithJson(
      "submit_answer",
      { optionIndex },
      room.roomId,
      clientId || (appState.phase !== "entry" ? appState.playerName : ""),
      envelopeBuilder
    );

    room.send("game/event", envelope);
  };

  if (appState.phase === "entry") {
    return <EntryScreen onSubmit={handleEntrySubmit} />;
  }

  if (appState.phase === "connecting") {
    return <EntryScreen onSubmit={handleEntrySubmit} />;
  }

  return (
    <PlayerUI
      state={gameState}
      playerName={appState.playerName}
      onReady={handleReady}
      onAnswer={handleAnswer}
    />
  );
};

// Main entry point
async function main() {
  render(<App />);

  // Handle Ctrl+C gracefully
  process.on("SIGINT", () => {
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
