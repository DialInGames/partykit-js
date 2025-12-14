import React, { useState, useEffect } from "react";
import { render, Box, Text } from "ink";
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
import { HostUI } from "./components/HostUI.js";

interface AppProps {
  roomCode?: string;
}

const LoadingScreen: React.FC = () => {
  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>Loading...</Text>
      <Text>Connecting to server...</Text>
    </Box>
  );
};

const App: React.FC<AppProps> = ({ roomCode }) => {
  const [client] = useState(() => new Client("ws://localhost:2567"));
  const [room, setRoom] = useState<Room | undefined>();
  const [gameState, setGameState] = useState<TriviaState | null>(null);

  const envelopeBuilder = defaultJSONEnvelopeBuilder;

  // Handle connection and setup
  useEffect(() => {
    const connect = async () => {
      try {
        // Create or join the Colyseus room with the specified ID
        const newRoom = await client.joinOrCreate("trivia", {
          code: roomCode,
        });
        setRoom(newRoom);

        // Send PartyKit hello message
        const helloEnvelope = createHelloEnvelope(
          {
            clientKind: ClientKind.DISPLAY,
            clientName: "Host",
            engine: "Node",
            engineVersion: process.version,
            sdk: "partykit-colyseus",
            sdkVersion: "1.0.0",
            room: newRoom.roomId,
            from: "host",
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
              from: "host",
            },
            envelopeBuilder
          );
          newRoom.send("partykit/room/join", joinEnvelope);
        });

        newRoom.onMessage("partykit/room/joined", () => {
          // Successfully joined
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
          } catch (err) {
            console.error("Error handling state update:", err);
          }
        });

        newRoom.onMessage("partykit/presence", () => {
          // Presence updates - state will follow
        });

        newRoom.onMessage("partykit/self", () => {
          // Self described
        });

        newRoom.onMessage("partykit/error", (payload: JsonValue) => {
          console.error("Server error:", payload);
        });

        newRoom.onLeave((code: number) => {
          process.exit(0);
        });

        newRoom.onError((code: number, message?: string) => {
          console.error(`Room error ${code}: ${message}`);
          process.exit(1);
        });
      } catch (e) {
        console.error("Failed to connect:", e);
        process.exit(1);
      }
    };

    connect();
  }, [client, roomCode, envelopeBuilder]);

  // Show loading screen until we have both room and initial state
  if (!room || !gameState) {
    return <LoadingScreen />;
  }

  return <HostUI state={gameState} roomId={room.roomId} />;
};

// Main entry point
async function main() {
  const roomCode = process.argv.length > 1 ? process.argv[2] : undefined;

  render(<App roomCode={roomCode} />);

  // Handle Ctrl+C gracefully
  process.on("SIGINT", () => {
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
