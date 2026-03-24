import { AgentJob } from "@/lib/types/chat";

const queue: AgentJob[] = [];

export function enqueueAgentJob(job: AgentJob) {
  queue.push(job);
}

export function dequeueAgentJob() {
  return queue.shift() ?? null;
}

export function getQueueSize() {
  return queue.length;
}
