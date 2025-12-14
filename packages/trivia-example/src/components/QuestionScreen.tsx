import React from "react";
import { Box, Text } from "ink";
import type { TriviaState } from "../types";

interface QuestionScreenProps {
  state: TriviaState;
  currentTime: number;
}

export const QuestionScreen: React.FC<QuestionScreenProps> = ({
  state,
  currentTime,
}) => {
  const question = state.questions[state.currentQuestionIndex];
  const questionNum = state.currentQuestionIndex + 1;
  const totalQuestions = state.questions.length;

  // Calculate remaining time
  const elapsed = (currentTime - state.questionStartTime!) / 1000;
  const remaining = Math.max(0, state.questionTimeLimit - elapsed);
  const timeColor =
    remaining < 10 ? "red" : remaining < 20 ? "yellow" : "green";

  return (
    <Box flexDirection="column" padding={1} width="100%">
      <Box
        borderStyle="double"
        borderColor="magenta"
        padding={1}
        flexDirection="row"
        justifyContent="space-between"
        width="100%"
      >
        <Text bold color="magenta">
          Question {questionNum}/{totalQuestions}
        </Text>
        <Text bold color={timeColor}>
          Time: {Math.ceil(remaining)}s
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan" wrap="wrap">
          {question.text}
        </Text>

        <Box marginTop={1} flexDirection="column">
          {question.options.map((option, i) => {
            const letter = String.fromCharCode(65 + i);
            return (
              <Box key={i} marginLeft={2}>
                <Text bold color="yellow">
                  {letter})
                </Text>
                <Text> {option}</Text>
              </Box>
            );
          })}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Player Status:</Text>

          {Object.entries(state.players).map(([clientId, player]) => {
            if (!player.isConnected) return null;

            const status = player.currentAnswer
              ? "✓ Answered"
              : "⏳ Thinking...";
            const statusColor = player.currentAnswer ? "green" : "yellow";

            return (
              <Box key={clientId} marginLeft={2}>
                <Text>
                  {player.name}: <Text color={statusColor}>{status}</Text>
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};
