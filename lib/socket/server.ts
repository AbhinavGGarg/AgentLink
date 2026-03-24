import { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { roomChannel } from "@/lib/socket/channels";

type SocketServerGlobal = typeof globalThis & {
  __agentlinkIo?: SocketIOServer;
};

export function getSocketServer() {
  return (globalThis as SocketServerGlobal).__agentlinkIo ?? null;
}

export function initSocketServer(httpServer: HttpServer) {
  const existing = getSocketServer();
  if (existing) {
    return existing;
  }

  const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    socket.on("join-room", (roomId: string) => {
      if (!roomId) {
        return;
      }
      socket.join(roomChannel(roomId));
    });

    socket.on("leave-room", (roomId: string) => {
      if (!roomId) {
        return;
      }
      socket.leave(roomChannel(roomId));
    });
  });

  (globalThis as SocketServerGlobal).__agentlinkIo = io;

  return io;
}
