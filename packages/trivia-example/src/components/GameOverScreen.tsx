import React from "react";
import { Box, Text } from "ink";
import type { TriviaState } from "../types";

interface GameOverScreenProps {
  state: TriviaState;
}

export const GameOverScreen: React.FC<GameOverScreenProps> = ({ state }) => {
  const winner = state.winnerId ? state.players[state.winnerId] : null;

  const sortedPlayers = Object.values(state.players).sort(
    (a, b) => b.score - a.score
  );

  return (
    <Box flexDirection="column" padding={1} width="100%">
      <Box borderStyle="double" borderColor="yellow" padding={1} width="100%">
        <Text bold color="yellow">
          GAME OVER!
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {winner ? (
          <Box flexDirection="column">
            <Text color="green" bold>
              🏆 WINNER: {winner.name}
            </Text>
            <Text>
              Score:{" "}
              <Text bold color="cyan">
                {winner.score}
              </Text>{" "}
              points
            </Text>
          </Box>
        ) : (
          <Text>No winner!</Text>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text bold>Final Scores:</Text>
          {sortedPlayers.map((player, i) => {
            const position = i + 1;
            const positionColor =
              position === 1 ? "green" : position === 2 ? "yellow" : "white";

            return (
              <Box key={player.name} marginLeft={2}>
                <Text color={positionColor}>
                  {position}. {player.name} - <Text bold>{player.score}</Text>{" "}
                  points
                </Text>
              </Box>
            );
          })}
        </Box>

        <Box marginTop={1}>
          <Text color="cyan" bold>
            Thanks for playing!
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
