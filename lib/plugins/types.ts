import { ChatMessage } from "@/lib/types/chat";

export type PluginContext = {
  roomId: string;
  latestMessage: ChatMessage;
};

export interface AgentBehaviorPlugin {
  id: string;
  describe(): string;
  beforeRespond?(context: PluginContext): Promise<void>;
  afterRespond?(context: PluginContext, response: string): Promise<void>;
}
