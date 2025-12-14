import React from "react";
import { Box, Text } from "ink";
import type { TriviaState } from "../types";

interface WaitingForReconnectionScreenProps {
  state: TriviaState;
}

export const WaitingForReconnectionScreen: React.FC<
  WaitingForReconnectionScreenProps
> = ({ state }) => {
  const waitingForPlayers = state.waitingForPlayers || [];
  const connectedPlayers = Object.entries(state.players).filter(
    ([_, player]) => player.isConnected
  );

  return (
    <Box flexDirection="column" padding={1} width="100%">
      <Box borderStyle="double" borderColor="yellow" padding={1} width="100%">
        <Text bold color="yellow">
          ⏸ GAME PAUSED
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="yellow" bold>
          Waiting for player reconnection...
        </Text>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Disconnected Players:</Text>
          {waitingForPlayers.map((clientId) => {
            const player = state.players[clientId];
            if (!player) return null;

            return (
              <Box key={clientId} marginLeft={2}>
                <Text color="red">
                  ○ {player.name} <Text color="gray">(disconnected)</Text>
                </Text>
              </Box>
            );
          })}
        </Box>

        {connectedPlayers.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Connected Players:</Text>
            {connectedPlayers.map(([clientId, player]) => (
              <Box key={clientId} marginLeft={2}>
                <Text color="green">
                  ● {player.name} <Text color="gray">(waiting)</Text>
                </Text>
              </Box>
            ))}
          </Box>
        )}

        <Box marginTop={1}>
          <Text color="gray">
            Game will continue when all players reconnect or after grace period
            expires...
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
