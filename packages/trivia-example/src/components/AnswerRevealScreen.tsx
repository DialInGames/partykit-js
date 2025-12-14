import React from "react";
import { Box, Text } from "ink";
import type { TriviaState } from "../types";

interface AnswerRevealScreenProps {
  state: TriviaState;
}

export const AnswerRevealScreen: React.FC<AnswerRevealScreenProps> = ({
  state,
}) => {
  const question = state.questions[state.currentQuestionIndex];
  const results = state.lastQuestionResults!;
  const correctLetter = String.fromCharCode(65 + results.correctAnswer);
  const correctAnswer = question.options[results.correctAnswer];

  const sortedPlayers = Object.values(state.players).sort(
    (a, b) => b.score - a.score
  );

  return (
    <Box flexDirection="column" padding={1} width="100%">
      <Box borderStyle="double" borderColor="green" padding={1} width="100%">
        <Text bold color="green">
          ANSWER REVEAL
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="green" bold>
          ✓ Correct Answer: {correctLetter}) {correctAnswer}
        </Text>

        <Box marginTop={1} flexDirection="column">
          {results.playersCorrect.length > 0 && (
            <Box flexDirection="column">
              <Text color="green" bold>
                ✓ CORRECT:
              </Text>
              {results.playersCorrect.map((clientId) => {
                const player = state.players[clientId];
                return (
                  <Box key={clientId} marginLeft={2}>
                    <Text color="green">
                      • {player.name} <Text bold>(+1 point)</Text>
                    </Text>
                  </Box>
                );
              })}
            </Box>
          )}

          {results.playersIncorrect.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="red" bold>
                ✗ INCORRECT:
              </Text>
              {results.playersIncorrect.map((clientId) => {
                const player = state.players[clientId];
                return (
                  <Box key={clientId} marginLeft={2}>
                    <Text color="red">• {player.name}</Text>
                  </Box>
                );
              })}
            </Box>
          )}

          {results.playersTimedOut.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="yellow" bold>
                ⏱ TIMED OUT:
              </Text>
              {results.playersTimedOut.map((clientId) => {
                const player = state.players[clientId];
                return (
                  <Box key={clientId} marginLeft={2}>
                    <Text color="yellow">• {player.name}</Text>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Current Scores:</Text>
          {sortedPlayers.map((player) => (
            <Box key={player.name} marginLeft={2}>
              <Text>
                {player.name}:{" "}
                <Text bold color="cyan">
                  {player.score}
                </Text>{" "}
                points
              </Text>
            </Box>
          ))}
        </Box>

        <Box marginTop={1}>
          <Text color="gray">Advancing to next question...</Text>
        </Box>
      </Box>
    </Box>
  );
};
