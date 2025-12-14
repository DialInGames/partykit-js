import React, { useState, useEffect } from "react";
import { render, Box, Text } from "ink";
import { Client, Room } from "colyseus.js";
import type { JsonValue } from "@bufbuild/protobuf";
import {
  createHelloEnvelope,
  createRoomJoinEnvelope,
  createGameEventEnvelopeWithJson,
  ClientKind,
  StateUpdateSchema,
  defaultJSONEnvelopeBuilder,
  HelloOkSchema,
} from "@dialingames/partykit-protocol";
import { TriviaState } from "./types.js";
import { EntryScreen } from "./components/EntryScreen.js";
import { PlayerUI } from "./components/PlayerUI.js";
import { command, option, optional, run, string } from "cmd-ts";
import { withFullScreen } from "fullscreen-ink";

// Status bar component to show reconnection info
const StatusBar: React.FC<{ roomCode?: string; reconnectToken?: string }> = ({
  roomCode,
  reconnectToken,
}) => {
  if (!roomCode && !reconnectToken) return null;

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
      flexDirection="column"
    >
      {roomCode && (
        <Text dimColor>
          Room: <Text bold>{roomCode}</Text>
        </Text>
      )}
      {reconnectToken && (
        <Text dimColor>
          Reconnect Token: <Text bold>{reconnectToken}</Text>
        </Text>
      )}
    </Box>
  );
};

type AppState =
  | { phase: "entry" }
  | { phase: "connecting"; roomCode: string; playerName: string }
  | { phase: "connected"; roomCode: string; playerName: string };

interface AppProps {
  initialRoomCode?: string;
  initialPlayerName?: string;
  reconnectionToken?: string;
}

const App: React.FC<AppProps> = ({
  initialRoomCode,
  initialPlayerName,
  reconnectionToken,
}) => {
  const [appState, setAppState] = useState<AppState>(() => {
    // Auto-connect if room code and name provided
    if (initialRoomCode && initialPlayerName) {
      return {
        phase: "connecting",
        roomCode: initialRoomCode,
        playerName: initialPlayerName,
      };
    }
    return { phase: "entry" };
  });
  const [client] = useState(() => new Client("ws://localhost:2567"));
  const [room, setRoom] = useState<Room | undefined>();
  const [gameState, setGameState] = useState<TriviaState | null>(null);
  const [clientId, setClientId] = useState<string | undefined>();
  const [currentReconnectToken, setCurrentReconnectToken] = useState<
    string | undefined
  >(reconnectionToken);

  const envelopeBuilder = defaultJSONEnvelopeBuilder;

  // Handle connection and setup
  useEffect(() => {
    if (appState.phase !== "connecting") return;

    const connect = async () => {
      try {
        // Join an existing Colyseus room (players cannot create rooms)
        const newRoom = await client.join("trivia", {
          roomId: appState.roomCode,
          reconnectionToken: currentReconnectToken,
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
            reconnectToken: currentReconnectToken,
            resumeRoom: appState.roomCode,
          },
          envelopeBuilder
        );

        newRoom.send("partykit/hello", helloEnvelope);

        // Set up message handlers
        newRoom.onMessage("partykit/hello/ok", (payload: JsonValue) => {
          try {
            const helloOk = envelopeBuilder.decodeAndUnpack(
              payload,
              HelloOkSchema
            );
            if (helloOk?.data.clientContext?.reconnectToken) {
              setCurrentReconnectToken(
                helloOk.data.clientContext.reconnectToken
              );
            }
          } catch (err) {
            console.error("Error extracting reconnect token:", err);
          }

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

  let screen;
  switch (appState.phase) {
    case "entry":
      screen = (
        <EntryScreen
          onSubmit={handleEntrySubmit}
          initialRoomCode={initialRoomCode}
          initialPlayerName={initialPlayerName}
        />
      );
      break;
    case "connecting":
      screen = (
        <EntryScreen
          onSubmit={handleEntrySubmit}
          initialRoomCode={initialRoomCode}
          initialPlayerName={initialPlayerName}
        />
      );
      break;
    default:
      screen = (
        <PlayerUI
          state={gameState}
          playerName={appState.playerName}
          onReady={handleReady}
          onAnswer={handleAnswer}
        />
      );
  }

  return (
    <Box flexDirection="column">
      {screen}
      <StatusBar
        roomCode={appState.phase !== "entry" ? appState.roomCode : undefined}
        reconnectToken={currentReconnectToken}
      />
    </Box>
  );
};

const cmd = command({
  name: "trivia-player-client",
  args: {
    roomCode: option({
      short: "c",
      long: "code",
      type: optional(string),
      description: "The room to join",
    }),
    name: option({
      short: "n",
      long: "name",
      type: optional(string),
      description: "Your name",
    }),
    reconnectionToken: option({
      short: "r",
      long: "reconnection-token",
      type: optional(string),
      description: "Optional token to reconnect to previous game",
    }),
  },
  handler: main,
});

// Main entry point
async function main(args: {
  roomCode?: string;
  name?: string;
  reconnectionToken?: string;
}) {
  withFullScreen(
    <App
      initialRoomCode={args.roomCode}
      initialPlayerName={args.name}
      reconnectionToken={args.reconnectionToken}
    />,
    {
      exitOnCtrlC: true,
    }
  ).start();
}

run(cmd, process.argv.slice(2));
