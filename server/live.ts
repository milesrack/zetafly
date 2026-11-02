import type { IncomingHttpHeaders, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { SessionPacket } from "../shared/contracts.ts";
import type { accessVerifier } from "./access.ts";
import type { SessionManager } from "./session-manager.ts";

declare module "ws" {
  interface WebSocket {
    userId?: string;
    sessionId?: string;
    authHeaders?: IncomingHttpHeaders;
  }
}

export class LiveConnections {
  private sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  private recheck?: ReturnType<typeof setInterval>;
  private identify: ReturnType<typeof accessVerifier>;
  private origins: Set<string>;

  constructor(identify: ReturnType<typeof accessVerifier>, origins: string[]) {
    this.identify = identify;
    this.origins = new Set(origins);
  }

  broadcast(ownerId: string, packet: SessionPacket) {
    const body = JSON.stringify(packet);

    for (const socket of this.sockets.clients) {
      if (
        socket.userId === ownerId &&
        socket.readyState === WebSocket.OPEN &&
        socket.bufferedAmount < 2_000_000
      ) {
        socket.send(body);
      }
    }
  }

  disconnectSession(id: string) {
    for (const socket of this.sockets.clients) {
      if (socket.sessionId === id) {
        socket.close(1000);
      }
    }
  }

  attach(server: Server, sessions: SessionManager) {
    server.on("upgrade", async (req, socket, head) => {
      try {
        if (
          req.url !== "/live" ||
          !this.origins.has(req.headers.origin ?? "")
        ) {
          socket.destroy();

          return;
        }

        const identity = await this.identify(req);

        if (!identity) {
          socket.destroy();

          return;
        }

        this.sockets.handleUpgrade(req, socket, head, (ws) => {
          ws.userId = identity.user.id;
          ws.sessionId = identity.session.id;
          ws.authHeaders = req.headers;

          ws.send(
            JSON.stringify({
              kind: "state",
              ...sessions.state(ws.userId),
              serverTime: Date.now(),
            }),
          );

          const current = sessions.current;

          if (current?.ownerId === ws.userId && current.session.screen) {
            ws.send(
              JSON.stringify({
                kind: "screen",
                png: current.session.screen,
                runId: current.session.state.runId,
              }),
            );
          }
        });
      } catch {
        socket.destroy();
      }
    });

    this.recheck = setInterval(() => {
      for (const socket of this.sockets.clients) {
        this.identify({ headers: socket.authHeaders ?? {} })
          .then((identity) => {
            if (!identity || identity.session.id !== socket.sessionId) {
              socket.close(1000);
            }
          })
          .catch(() => socket.close(1011));
      }
    }, 30000);
  }

  close() {
    clearInterval(this.recheck);

    for (const socket of this.sockets.clients) {
      socket.close();
    }

    this.sockets.close();
  }
}
