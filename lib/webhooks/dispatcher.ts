export type WebhookEvent = {
  type: "message.created" | "agent.responded";
  payload: Record<string, unknown>;
};

export async function dispatchWebhook(event: WebhookEvent): Promise<void> {
  void event;
  // Hook point for future outbound webhooks.
}
