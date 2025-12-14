import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { TriviaState } from "../types.js";

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

const LobbyScreen: React.FC<{ state: TriviaState; roomId: string }> = ({
  state,
  roomId,
}) => {
  const playerList = Object.values(state.players);
  const allReady =
    playerList.length > 0 &&
    playerList.every((p) => p.isReady || !p.isConnected);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="double" borderColor="cyan" padding={1}>
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

const QuestionScreen: React.FC<{
  state: TriviaState;
  currentTime: number;
}> = ({ state, currentTime }) => {
  const question = state.questions[state.currentQuestionIndex];
  const questionNum = state.currentQuestionIndex + 1;
  const totalQuestions = state.questions.length;

  // Calculate remaining time
  const elapsed = (currentTime - state.questionStartTime!) / 1000;
  const remaining = Math.max(0, state.questionTimeLimit - elapsed);
  const timeColor =
    remaining < 10 ? "red" : remaining < 20 ? "yellow" : "green";

  return (
    <Box flexDirection="column" padding={1}>
      <Box
        borderStyle="double"
        borderColor="magenta"
        padding={1}
        flexDirection="row"
        justifyContent="space-between"
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

const AnswerRevealScreen: React.FC<{ state: TriviaState }> = ({ state }) => {
  const question = state.questions[state.currentQuestionIndex];
  const results = state.lastQuestionResults!;
  const correctLetter = String.fromCharCode(65 + results.correctAnswer);
  const correctAnswer = question.options[results.correctAnswer];

  const sortedPlayers = Object.values(state.players).sort(
    (a, b) => b.score - a.score
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="double" borderColor="green" padding={1}>
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

const WaitingForReconnectionScreen: React.FC<{ state: TriviaState }> = ({
  state,
}) => {
  const waitingForPlayers = state.waitingForPlayers || [];
  const connectedPlayers = Object.entries(state.players).filter(
    ([_, player]) => player.isConnected
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="double" borderColor="yellow" padding={1}>
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

const GameOverScreen: React.FC<{ state: TriviaState }> = ({ state }) => {
  const winner = state.winnerId ? state.players[state.winnerId] : null;

  const sortedPlayers = Object.values(state.players).sort(
    (a, b) => b.score - a.score
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="double" borderColor="yellow" padding={1}>
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
