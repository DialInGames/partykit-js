import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";
import { TriviaRoom } from "./TriviaRoom";

const httpServer = createServer();
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
  }),
});

gameServer.define("trivia", TriviaRoom);

httpServer.listen(2567);
console.log("Colyseus listening on ws://localhost:2567");
