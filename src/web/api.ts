import type {
  BrowserPushSubscription,
  Domain,
  GeneralSettings,
  Label,
  LabelInput,
  Mailbox,
  Playbook,
  PlaybookInput,
  ReplyAttemptResult,
  ThreadSummary,
  ThreadDetail,
} from "../shared/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status-based fallback for non-JSON responses.
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const fetchMailboxes = () => request<Mailbox[]>("/mailboxes");

export const fetchGeneralSettings = () =>
  request<GeneralSettings>("/settings/general");

export const enableBrowserNotifications = (subscription: BrowserPushSubscription) =>
  request<{ ok: true }>("/settings/browser-notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription),
  });

export const disableBrowserNotifications = () =>
  request<{ ok: true }>("/settings/browser-notifications", { method: "DELETE" });

export const fetchDomains = () => request<Domain[]>("/domains");

export const createDomain = (input: { name: string }) =>
  request<Domain>("/domains", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const activateDomain = (id: number) =>
  request<Domain>(`/domains/${id}/activate`, { method: "POST" });

export const createMailbox = (input: { local_part: string; domain_id: number }) =>
  request<Mailbox>("/mailboxes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const updateMailbox = (
  id: number,
  input: Partial<Pick<Mailbox, "agent_mode" | "agent_instructions">>,
) =>
  request<{ ok: true }>(`/mailboxes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const deleteMailbox = (id: number, confirmAddress: string) =>
  request<{ ok: true; deleted_id: number; domain_id: number | null }>(`/mailboxes/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm_address: confirmAddress }),
  });

export const fetchPlaybooks = (mailboxId: number) =>
  request<Playbook[]>(`/playbooks?mailbox_id=${mailboxId}`);

export const createPlaybook = (input: PlaybookInput) =>
  request<Playbook>("/playbooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const updatePlaybook = (id: number, input: Partial<PlaybookInput>) =>
  request<Playbook>(`/playbooks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const deletePlaybook = (id: number) =>
  request<{ ok: true }>(`/playbooks/${id}`, { method: "DELETE" });

export const fetchLabels = (mailboxId?: number | null) =>
  request<Label[]>(`/labels${mailboxId ? `?mailbox_id=${mailboxId}` : ""}`);

export const createLabel = (input: LabelInput) =>
  request<Label>("/labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const updateLabel = (id: number, input: Partial<LabelInput>) =>
  request<Label>(`/labels/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const deleteLabel = (id: number) =>
  request<{ ok: true }>(`/labels/${id}`, { method: "DELETE" });

function threadListParams(mailboxId: number | null, labelId: number | null) {
  const params = new URLSearchParams();
  if (mailboxId !== null) params.set("mailbox_id", String(mailboxId));
  if (labelId !== null) params.set("label_id", String(labelId));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const fetchThreads = (mailboxId: number | null, labelId: number | null = null) =>
  request<ThreadSummary[]>(`/threads${threadListParams(mailboxId, labelId)}`);

export const fetchThread = (id: number) => request<ThreadDetail>(`/threads/${id}`);

export const searchThreads = (q: string, mailboxId: number | null, labelId: number | null = null) => {
  const params = new URLSearchParams({ q });
  if (mailboxId !== null) params.set("mailbox_id", String(mailboxId));
  if (labelId !== null) params.set("label_id", String(labelId));
  return request<ThreadSummary[]>(`/search?${params}`);
};

export const bulkUpdateThreads = (ids: number[], action: "read" | "archive") =>
  request<{ ok: true; updated: number }>("/threads/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, action }),
  });

export const markRead = (id: number) => request(`/threads/${id}/read`, { method: "POST" });

export const archiveThread = (id: number) => request(`/threads/${id}/archive`, { method: "POST" });

export const sendReply = (
  id: number,
  text: string,
  attemptId: string,
  draftId?: number,
  attachments: File[] = [],
) => {
  const form = new FormData();
  form.set("text", text);
  form.set("attempt_id", attemptId);
  if (draftId !== undefined) form.set("draft_id", String(draftId));
  for (const file of attachments) form.append("attachments", file, file.name);
  return request<ReplyAttemptResult>(`/threads/${id}/reply`, {
    method: "POST",
    body: form,
  });
};

export const discardDraft = (id: number) => request(`/drafts/${id}/discard`, { method: "POST" });

export const retryDraftRun = (id: number) =>
  request<{ ok: true }>(`/draft-runs/${id}/retry`, { method: "POST" });

export const createDraft = (threadId: number) =>
  request<{ ok: true; run_id: number }>(`/threads/${threadId}/draft`, { method: "POST" });
