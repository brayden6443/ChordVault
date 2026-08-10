import type { PersistedWorkflowStatus } from "./persisted.ts";

export type WorkflowAction = "import" | "approve" | "reject" | "restore" | "metadata-update" | "enrichment" | "replace-old" | "replace-new";

export class WorkflowTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";
  readonly action: WorkflowAction;
  readonly from: PersistedWorkflowStatus | null;
  constructor(action: WorkflowAction, from: PersistedWorkflowStatus | null) {
    super(`Cannot ${action} a chord from ${from ?? "new"}.`);
    this.name = "WorkflowTransitionError";
    this.action = action; this.from = from;
  }
}

export function workflowTransition(from: PersistedWorkflowStatus | null, action: WorkflowAction): PersistedWorkflowStatus {
  if (action === "import" && from === null) return "pre-reviewed";
  if (action === "approve" && from === "pre-reviewed") return "published";
  if (action === "reject" && from === "pre-reviewed") return "rejected";
  if (action === "restore" && from === "rejected") return "pre-reviewed";
  if (action === "metadata-update" && from === "published") return "published";
  if (action === "enrichment" && from !== null) return from;
  if (action === "replace-old" && from === "published") return "rejected";
  if (action === "replace-new" && (from === null || from === "pre-reviewed")) return "published";
  throw new WorkflowTransitionError(action, from);
}
