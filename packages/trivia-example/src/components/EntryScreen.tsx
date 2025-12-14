import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface EntryScreenProps {
  onSubmit: (roomName: string, playerName: string) => void;
}

export const EntryScreen: React.FC<EntryScreenProps> = ({ onSubmit }) => {
  const [roomName, setRoomName] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [currentField, setCurrentField] = useState<"room" | "player">("room");

  useInput((input, key) => {
    if (key.return) {
      if (currentField === "room") {
        setCurrentField("player");
      } else if (currentField === "player") {
        const finalRoomName = roomName.trim() || "partykit";
        const finalPlayerName =
          playerName.trim() || `Player${Math.floor(Math.random() * 1000)}`;
        onSubmit(finalRoomName, finalPlayerName);
      }
    } else if (key.backspace || key.delete) {
      if (currentField === "room") {
        setRoomName((prev) => prev.slice(0, -1));
      } else {
        setPlayerName((prev) => prev.slice(0, -1));
      }
    } else if (!key.ctrl && !key.meta && input) {
      if (currentField === "room") {
        setRoomName((prev) => prev + input);
      } else {
        setPlayerName((prev) => prev + input);
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" padding={1}>
        <Text bold color="cyan">
          TRIVIA GAME - PLAYER
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text>
            Enter room ID (default: partykit):{" "}
            {currentField === "room" ? (
              <Text color="cyan" bold>
                {roomName}
                <Text inverse>_</Text>
              </Text>
            ) : (
              <Text color="green">{roomName || "partykit"}</Text>
            )}
          </Text>
        </Box>

        {currentField === "player" && (
          <Box marginTop={1}>
            <Text>
              Enter your name:{" "}
              <Text color="cyan" bold>
                {playerName}
                <Text inverse>_</Text>
              </Text>
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
