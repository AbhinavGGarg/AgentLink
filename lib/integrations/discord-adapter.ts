import { BridgeAdapter, BridgeMessage } from "@/lib/integrations/bridge-adapter";

export class DiscordBridgeAdapter implements BridgeAdapter {
  name = "discord";

  async send(message: BridgeMessage): Promise<void> {
    void message;
    // Hook point for future Discord relay support.
  }
}
