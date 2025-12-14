import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { TriviaState } from "../types.js";

interface PlayerUIProps {
  state: TriviaState | null;
  playerName: string;
  onReady: () => void;
  onAnswer: (optionIndex: number) => void;
}

export const PlayerUI: React.FC<PlayerUIProps> = ({
  state,
  playerName,
  onReady,
  onAnswer,
}) => {
  const [inputMode, setInputMode] = useState<"none" | "ready" | "answer">("none");
  const [answerBuffer, setAnswerBuffer] = useState("");

  useEffect(() => {
    if (!state) {
      setInputMode("none");
      return;
    }

    const myPlayer = Object.values(state.players).find(
      (p) => p.name === playerName
    );

    if (state.phase === "lobby" && myPlayer && !myPlayer.isReady) {
      setInputMode("ready");
    } else if (
      state.phase === "question" &&
      myPlayer &&
      !myPlayer.currentAnswer
    ) {
      setInputMode("answer");
      setAnswerBuffer("");
    } else {
      setInputMode("none");
    }
  }, [state, playerName]);

  useInput((input, key) => {
    if (inputMode === "ready" && key.return) {
      onReady();
      setInputMode("none");
    } else if (inputMode === "answer") {
      const upper = input.toUpperCase();
      if (upper >= "A" && upper <= "D") {
        const answerIndex = upper.charCodeAt(0) - 65;
        onAnswer(answerIndex);
        setInputMode("none");
      }
    }
  });

  if (!state) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="round" borderColor="cyan" padding={1}>
          <Text bold color="cyan">
            TRIVIA GAME - PLAYER
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
      return <LobbyScreen state={state} playerName={playerName} inputMode={inputMode} />;
    case "question":
      return (
        <QuestionScreen
          state={state}
          playerName={playerName}
          inputMode={inputMode}
        />
      );
    case "answer_reveal":
      return <AnswerRevealScreen state={state} playerName={playerName} />;
    case "waiting_for_reconnection":
      return <WaitingForReconnectionScreen state={state} playerName={playerName} />;
    case "game_over":
      return <GameOverScreen state={state} playerName={playerName} />;
    default:
      return <Text>Unknown game phase</Text>;
  }
};

const LobbyScreen: React.FC<{
  state: TriviaState;
  playerName: string;
  inputMode: string;
}> = ({ state, playerName, inputMode }) => {
  const myPlayer = Object.values(state.players).find(
    (p) => p.name === playerName
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" padding={1}>
        <Text bold color="cyan">
          LOBBY
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="green">Welcome, {playerName}!</Text>
        <Box marginTop={1}>
          <Text bold>Players in room:</Text>
        </Box>

        {Object.values(state.players).map((player) => {
          const readyIcon = player.isReady ? "✓" : " ";
          const isSelf = player.name === playerName ? " (you)" : "";
          return (
            <Box key={player.name} marginLeft={2}>
              <Text color={player.isReady ? "green" : "yellow"}>
                [{readyIcon}] {player.name}
                {isSelf}
              </Text>
            </Box>
          );
        })}

        <Box marginTop={1}>
          {myPlayer && !myPlayer.isReady && inputMode === "ready" ? (
            <Text color="yellow">Press Enter when ready</Text>
          ) : myPlayer && myPlayer.isReady ? (
            <Text color="green">✓ You are ready! Waiting for others...</Text>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
};

const QuestionScreen: React.FC<{
  state: TriviaState;
  playerName: string;
  inputMode: string;
}> = ({ state, playerName, inputMode }) => {
  const question = state.questions[state.currentQuestionIndex];
  const questionNum = state.currentQuestionIndex + 1;
  const totalQuestions = state.questions.length;

  const myPlayer = Object.values(state.players).find(
    (p) => p.name === playerName
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="magenta" padding={1}>
        <Text bold color="magenta">
          Question {questionNum}/{totalQuestions}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">
          {question.text}
        </Text>

        <Box marginTop={1} flexDirection="column">
          {question.options.map((option, i) => {
            const letter = String.fromCharCode(65 + i);
            return (
              <Box key={i} marginLeft={2}>
                <Text>
                  {letter}) {option}
                </Text>
              </Box>
            );
          })}
        </Box>

        <Box marginTop={1}>
          {myPlayer && !myPlayer.currentAnswer && inputMode === "answer" ? (
            <Text color="yellow">Your answer (A-D): </Text>
          ) : myPlayer && myPlayer.currentAnswer ? (
            <Box flexDirection="column">
              <Text color="green">
                ✓ Your answer:{" "}
                {String.fromCharCode(65 + myPlayer.currentAnswer.optionIndex)})
                {" "}
                {question.options[myPlayer.currentAnswer.optionIndex]}
              </Text>
              <Text color="gray">Waiting for other players...</Text>
            </Box>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
};

const AnswerRevealScreen: React.FC<{
  state: TriviaState;
  playerName: string;
}> = ({ state, playerName }) => {
  const question = state.questions[state.currentQuestionIndex];
  const results = state.lastQuestionResults!;
  const correctLetter = String.fromCharCode(65 + results.correctAnswer);
  const correctAnswer = question.options[results.correctAnswer];

  const myPlayer = Object.values(state.players).find(
    (p) => p.name === playerName
  );

  const myClientId = Object.keys(state.players).find(
    (id) => state.players[id].name === playerName
  );

  let myResult = null;
  if (myClientId) {
    if (results.playersCorrect.includes(myClientId)) {
      myResult = "correct";
    } else if (results.playersIncorrect.includes(myClientId)) {
      myResult = "incorrect";
    } else if (results.playersTimedOut.includes(myClientId)) {
      myResult = "timeout";
    }
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="green" padding={1}>
        <Text bold color="green">
          ANSWER REVEAL
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="green" bold>
          ✓ Correct Answer: {correctLetter}) {correctAnswer}
        </Text>

        <Box marginTop={1}>
          {myResult === "correct" && (
            <Text color="green">🎉 CORRECT! You earned 1 point!</Text>
          )}
          {myResult === "incorrect" && (
            <Text color="red">✗ Incorrect. Better luck next time!</Text>
          )}
          {myResult === "timeout" && (
            <Text color="yellow">⏱ Time's up! You didn't answer.</Text>
          )}
        </Box>

        {myPlayer && (
          <Box marginTop={1}>
            <Text>
              Your score: <Text bold color="cyan">{myPlayer.score}</Text> points
            </Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text color="gray">Watch the display for the next question...</Text>
        </Box>
      </Box>
    </Box>
  );
};

const WaitingForReconnectionScreen: React.FC<{
  state: TriviaState;
  playerName: string;
}> = ({ state, playerName }) => {
  const myPlayer = Object.values(state.players).find(
    (p) => p.name === playerName
  );

  const waitingForPlayers = state.waitingForPlayers || [];
  const isWaitingForMe = waitingForPlayers.some(
    (clientId) => state.players[clientId]?.name === playerName
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="yellow" padding={1}>
        <Text bold color="yellow">
          ⏸ GAME PAUSED
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {myPlayer?.isConnected ? (
          <>
            <Text color="green">● You are connected</Text>
            <Box marginTop={1}>
              <Text color="yellow">
                Waiting for disconnected players to reconnect...
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text color="gray">
                {waitingForPlayers.length} player(s) disconnected. Game will
                resume when they reconnect or after grace period expires.
              </Text>
            </Box>
          </>
        ) : (
          <>
            <Text color="red" bold>
              ○ You are disconnected
            </Text>
            <Box marginTop={1}>
              <Text color="yellow">
                Please check your connection. The game will wait for you to
                reconnect.
              </Text>
            </Box>
          </>
        )}

        {myPlayer && (
          <Box marginTop={1}>
            <Text>
              Your current score:{" "}
              <Text bold color="cyan">
                {myPlayer.score}
              </Text>{" "}
              points
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

const GameOverScreen: React.FC<{
  state: TriviaState;
  playerName: string;
}> = ({ state, playerName }) => {
  const winner = state.winnerId ? state.players[state.winnerId] : null;

  const myPlayer = Object.values(state.players).find(
    (p) => p.name === playerName
  );

  const sortedPlayers = Object.values(state.players).sort(
    (a, b) => b.score - a.score
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="yellow" padding={1}>
        <Text bold color="yellow">
          GAME OVER!
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {winner && myPlayer && winner.name === myPlayer.name ? (
          <Text color="green" bold>
            🏆 YOU WON! Congratulations!
          </Text>
        ) : winner ? (
          <Text color="yellow">🏆 Winner: {winner.name}</Text>
        ) : null}

        {myPlayer && (
          <Box marginTop={1}>
            <Text>
              Your final score: <Text bold color="cyan">{myPlayer.score}</Text>{" "}
              points
            </Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text bold>Final Standings:</Text>
        </Box>

        {sortedPlayers.map((player, i) => (
          <Box key={player.name} marginLeft={2}>
            <Text>
              {i + 1}. {player.name} - {player.score} points
            </Text>
          </Box>
        ))}

        <Box marginTop={1}>
          <Text color="gray">Returning to entry screen in 5 seconds...</Text>
        </Box>
      </Box>
    </Box>
  );
};