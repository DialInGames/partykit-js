# PartyKit JS

A TypeScript implementation of the PartyKit protocol for building multiplayer party games.

## Overview

This monorepo contains packages for implementing PartyKit-compatible game servers using the Colyseus framework.

## Packages

### [@dialingames/partykit-colyseus](packages/colyseus)

A Colyseus adapter that implements the PartyKit protocol, allowing you to build multiplayer games that follow the PartyKit specification.

**Features:**
- Full PartyKit protocol implementation (Hello, RoomJoin, GameEvent, State, Presence, Ping/Pong)
- TypeScript-first with full type safety
- Protobuf-based messaging using @bufbuild/protobuf
- Built on Colyseus room system
- Support for authentication, authorization, and capabilities
- Client presence tracking
- State snapshots with patch support

### [@dialingames/trivia-example](packages/trivia-example)

A complete example implementation of a trivia game server using the partykit-colyseus package. This serves as both a working example and a template for building your own games.

## Getting Started

### Installation

```bash
yarn install
```

### Building

Build all packages:

```bash
yarn build
```

Or build a specific package:

```bash
yarn workspace @dialingames/partykit-colyseus build
```

### Running the Example

```bash
yarn workspace @dialingames/trivia-example start
```

The server will start on `ws://localhost:2567`.

For development with auto-reload:

```bash
yarn workspace @dialingames/trivia-example dev
```

## Creating Your Own Game

1. Create a new package or project
2. Install dependencies:

```bash
yarn add @dialingames/partykit-colyseus colyseus @colyseus/core @colyseus/ws-transport
```

3. Create your room by extending `PartyKitColyseusRoom`:

```typescript
import { PartyKitColyseusRoom } from "@dialingames/partykit-colyseus";
import type { Client } from "colyseus";
import type { PartyKitAuthResult } from "@dialingames/partykit-colyseus";
import { Hello, RoomJoin, GameEvent } from "@buf/dialingames_partykit.bufbuild_es/...";

export class MyGameRoom extends PartyKitColyseusRoom {
  // Authenticate clients
  protected async authorizeHello(
    client: Client,
    hello: Hello
  ): Promise<PartyKitAuthResult> {
    return {
      ok: true,
      context: {
        clientId: client.sessionId,
        kind: hello.client?.kind ?? "player",
        displayName: hello.client?.name ?? "Player",
        role: "player",
        capabilities: [],
        groups: [],
        metadata: {},
      },
    };
  }

  // Handle when a client joins the room
  protected async onPartyKitJoin(
    client: Client,
    ctx: any,
    join: RoomJoin
  ): Promise<void> {
    // Your join logic here
  }

  // Handle game events from clients
  protected async onPartyKitGameEvent(
    client: Client,
    ctx: any,
    ev: GameEvent
  ): Promise<void> {
    // Your game event logic here
  }

  // Provide state snapshots to clients
  protected async getStateSnapshot(ctx: any): Promise<unknown> {
    return {
      // Your game state here
    };
  }
}
```

4. Create your server:

```typescript
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";
import { MyGameRoom } from "./MyGameRoom";

const httpServer = createServer();
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
  }),
});

gameServer.define("my-game", MyGameRoom);

httpServer.listen(2567);
console.log("Server listening on ws://localhost:2567");
```

## Architecture

The PartyKit protocol is implemented as a layer on top of an existing
multiplayer game server framework like Colyseus:

```plain
┌─────────────────────────────────────┐
│   Your Game Room Implementation     │
│  (extends PartyKitColyseusRoom)     │
├─────────────────────────────────────┤
│    @dialingames/partykit-colyseus   │
│    (PartyKit Protocol Layer)        │
├─────────────────────────────────────┤
│         Game Server Framework       │
│    (Room management & transport)    │
├─────────────────────────────────────┤
│          WebSocket Transport        │
└─────────────────────────────────────┘
```

## Development

### Project Structure

```plain
partykit-js/
├── packages/
│   ├── colyseus/           # Core PartyKit-Colyseus adapter
│   │   ├── src/
│   │   │   ├── PartyKitColyseusRoom.ts
│   │   │   ├── codec/
│   │   │   ├── types.ts
│   │   │   └── ...
│   │   └── package.json
│   └── trivia-example/     # Example trivia game
│       ├── src/
│       │   ├── server.ts
│       │   └── TriviaRoom.ts
│       └── package.json
├── proto/                  # Protocol buffer definitions
├── tsconfig.base.json
└── package.json
```

### Running Tests

```bash
yarn test
```

### Generating Protocol Buffers

```bash
yarn gen:proto
```

## License

[Add your license here]

## Contributing

Contributions are welcome! Please open an issue or pull request.
