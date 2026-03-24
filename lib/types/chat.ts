export type SenderType = "human" | "agent";

export type ChatMessage = {
  id: string;
  roomId: string;
  senderType: SenderType;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
};

export type RoomSummary = {
  id: string;
  name: string;
  participantCount: number;
  agentCount: number;
  ownerUsername?: string;
  friendsCanView?: boolean;
  isFriendView?: boolean;
};

export type RoomAgentSummary = {
  agentId: string;
  roomId: string;
  name: string;
  model: string;
  enabled: boolean;
  respondOnlyWhenMentioned: boolean;
};

export type ParticipantSummary = {
  id: string;
  username: string;
};

export type AgentThinkingEvent = {
  roomId: string;
  agentId: string;
  agentName: string;
  thinking: boolean;
};

export type AgentJob = {
  roomId: string;
  triggerMessageId: string;
  depth: number;
  forceAgentId?: string;
};
