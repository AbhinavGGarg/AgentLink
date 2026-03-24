import { BridgeAdapter, BridgeMessage } from "@/lib/integrations/bridge-adapter";

export class SlackBridgeAdapter implements BridgeAdapter {
  name = "slack";

  async send(message: BridgeMessage): Promise<void> {
    void message;
    // Hook point for future Slack relay support.
  }
}
