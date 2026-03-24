import { AgentThinkingEvent, ChatMessage } from "@/lib/types/chat";
import { roomChannel } from "@/lib/socket/channels";
import { getSocketServer } from "@/lib/socket/server";

export function emitMessage(roomId: string, payload: ChatMessage) {
  const io = getSocketServer();
  if (!io) {
    return;
  }

  io.to(roomChannel(roomId)).emit("message:new", payload);
}

export function emitAgentThinking(event: AgentThinkingEvent) {
  const io = getSocketServer();
  if (!io) {
    return;
  }

  io.to(roomChannel(event.roomId)).emit("agent:thinking", event);
}
