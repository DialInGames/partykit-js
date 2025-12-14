import React from "react";
import { Box, Text } from "ink";
import type { TriviaState } from "../types";

interface LobbyScreenProps {
  state: TriviaState;
  roomId: string;
}

export const LobbyScreen: React.FC<LobbyScreenProps> = ({ state, roomId }) => {
  const playerList = Object.values(state.players);
  const allReady =
    playerList.length > 0 &&
    playerList.every((p) => p.isReady || !p.isConnected);

  return (
    <Box flexDirection="column" padding={1} width="100%">
      <Box borderStyle="double" borderColor="cyan" padding={1} width="100%">
        <Text bold color="cyan">
          TRIVIA GAME - LOBBY
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text>
          Room:{" "}
          <Text color="cyan" bold>
            {roomId}
          </Text>
        </Text>

        {playerList.length === 0 ? (
          <Box marginTop={1}>
            <Text color="yellow">Waiting for players to join...</Text>
          </Box>
        ) : (
          <>
            <Box marginTop={1}>
              <Text bold>Players:</Text>
            </Box>

            {playerList.map((player) => {
              const readyIcon = player.isReady ? "✓" : " ";
              const connIcon = player.isConnected ? "●" : "○";
              const readyColor = player.isReady ? "green" : "yellow";
              const connColor = player.isConnected ? "green" : "red";

              return (
                <Box key={player.name} marginLeft={2}>
                  <Text color={readyColor}>[{readyIcon}]</Text>
                  <Text> </Text>
                  <Text color={connColor}>{connIcon}</Text>
                  <Text> {player.name}</Text>
                </Box>
              );
            })}

            <Box marginTop={1}>
              {allReady ? (
                <Text color="green" bold>
                  🎮 Game starting...
                </Text>
              ) : (
                <Text color="yellow">
                  Waiting for all players to ready up...
                </Text>
              )}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};
