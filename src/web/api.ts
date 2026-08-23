import type {
  Domain,
  Mailbox,
  Playbook,
  PlaybookInput,
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

export const fetchThreads = (mailboxId: number | null) =>
  request<ThreadSummary[]>(`/threads${mailboxId ? `?mailbox_id=${mailboxId}` : ""}`);

export const fetchThread = (id: number) => request<ThreadDetail>(`/threads/${id}`);

export const searchThreads = (q: string, mailboxId: number | null) => {
  const params = new URLSearchParams({ q });
  if (mailboxId !== null) params.set("mailbox_id", String(mailboxId));
  return request<ThreadSummary[]>(`/search?${params}`);
};

export const markRead = (id: number) => request(`/threads/${id}/read`, { method: "POST" });

export const archiveThread = (id: number) => request(`/threads/${id}/archive`, { method: "POST" });

export const sendReply = (id: number, text: string, draftId?: number) =>
  request(`/threads/${id}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, draft_id: draftId }),
  });

export const discardDraft = (id: number) => request(`/drafts/${id}/discard`, { method: "POST" });
