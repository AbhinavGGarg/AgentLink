export type BridgeMessage = {
  roomId: string;
  senderName: string;
  content: string;
  timestamp: string;
};

export interface BridgeAdapter {
  name: string;
  send(message: BridgeMessage): Promise<void>;
}
