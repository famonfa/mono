import type { SessionStatus } from "./sessions";

export type StageAgent = { id: string; status: SessionStatus; subs: { status: SessionStatus }[] };

export function createAgentStage(canvas: HTMLCanvasElement): {
  setAgents(list: StageAgent[]): void;
  dispose(): void;
};
