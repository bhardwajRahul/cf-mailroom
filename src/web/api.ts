import type { Mailbox, ThreadSummary, ThreadDetail } from "../shared/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchMailboxes = () => request<Mailbox[]>("/mailboxes");

export const fetchThreads = (mailboxId: number | null) =>
  request<ThreadSummary[]>(`/threads${mailboxId ? `?mailbox_id=${mailboxId}` : ""}`);

export const fetchThread = (id: number) => request<ThreadDetail>(`/threads/${id}`);

export const markRead = (id: number) => request(`/threads/${id}/read`, { method: "POST" });

export const archiveThread = (id: number) => request(`/threads/${id}/archive`, { method: "POST" });

export const sendReply = (id: number, text: string, draftId?: number) =>
  request(`/threads/${id}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, draft_id: draftId }),
  });

export const discardDraft = (id: number) => request(`/drafts/${id}/discard`, { method: "POST" });
