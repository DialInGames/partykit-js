import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { TriviaState } from "../types";
import { LobbyScreen } from "./LobbyScreen";
import { QuestionScreen } from "./QuestionScreen";
import { AnswerRevealScreen } from "./AnswerRevealScreen";
import { WaitingForReconnectionScreen } from "./WaitingForReconnectionScreen";
import { GameOverScreen } from "./GameOverScreen";

interface HostUIProps {
  state: TriviaState | null;
  roomId: string;
}

export const HostUI: React.FC<HostUIProps> = ({ state, roomId }) => {
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update time every second for question timer
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  if (!state) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="round" borderColor="cyan" padding={1}>
          <Text bold color="cyan">
            TRIVIA GAME - HOST
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>Waiting for game state...</Text>
        </Box>
      </Box>
    );
  }

  switch (state.phase) {
    case "lobby":
      return <LobbyScreen state={state} roomId={roomId} />;
    case "question":
      return <QuestionScreen state={state} currentTime={currentTime} />;
    case "answer_reveal":
      return <AnswerRevealScreen state={state} />;
    case "waiting_for_reconnection":
      return <WaitingForReconnectionScreen state={state} />;
    case "game_over":
      return <GameOverScreen state={state} />;
    default:
      const exhaustiveCheck: never = state.phase;
      return <Text>Unknown game phase</Text>;
  }
};
