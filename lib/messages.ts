import { Prisma } from "@prisma/client";
import { ChatMessage, RoomAgentSummary, RoomSummary } from "@/lib/types/chat";

export const messageWithSenderInclude = {
  senderUser: {
    select: {
      id: true,
      username: true,
    },
  },
  senderAgent: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.MessageInclude;

type DbMessage = Prisma.MessageGetPayload<{
  include: typeof messageWithSenderInclude;
}>;

export function toChatMessage(message: DbMessage): ChatMessage {
  const senderId =
    message.senderType === "human"
      ? message.senderUser?.id ?? "unknown-human"
      : message.senderAgent?.id ?? "unknown-agent";

  const senderName =
    message.senderType === "human"
      ? message.senderUser?.username ?? "Unknown Human"
      : message.senderAgent?.name ?? "Unknown Agent";

  return {
    id: message.id,
    roomId: message.roomId,
    senderType: message.senderType,
    senderId,
    senderName,
    content: message.content,
    timestamp: message.createdAt.toISOString(),
  };
}

export function toRoomSummary(room: {
  id: string;
  name: string;
  friendsCanView?: boolean;
  createdBy?: { username: string };
  _count: { participants: number; roomAgents: number };
}): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    participantCount: room._count.participants,
    agentCount: room._count.roomAgents,
    ownerUsername: room.createdBy?.username,
    friendsCanView: room.friendsCanView,
  };
}

export function toRoomAgentSummary(agent: {
  roomId: string;
  agentId: string;
  enabled: boolean;
  agent: {
    name: string;
    model: string;
    respondOnlyWhenMentioned: boolean;
  };
}): RoomAgentSummary {
  return {
    roomId: agent.roomId,
    agentId: agent.agentId,
    name: agent.agent.name,
    model: agent.agent.model,
    enabled: agent.enabled,
    respondOnlyWhenMentioned: agent.agent.respondOnlyWhenMentioned,
  };
}
