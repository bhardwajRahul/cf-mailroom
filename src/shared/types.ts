export interface Mailbox {
  id: number;
  address: string;
  color: string;
  agent_mode: "off" | "draft" | "auto";
  agent_instructions: string | null;
  unread_count: number;
}

export interface Domain {
  id: number;
  name: string;
  status: "pending" | "active";
  inbox_count: number;
  created_at: string;
  activated_at: string | null;
}

export interface Playbook {
  id: number;
  mailbox_id: number;
  name: string;
  when_to_use: string;
  instructions: string;
  example_reply: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface PlaybookInput {
  mailbox_id: number;
  name: string;
  when_to_use: string;
  instructions: string;
  example_reply?: string | null;
  enabled?: boolean;
}

export interface ThreadSummary {
  id: number;
  mailbox_id: number;
  mailbox_address: string;
  mailbox_color: string;
  subject: string;
  snippet: string;
  status: "open" | "archived" | "needs_human";
  is_read: number;
  message_count: number;
  pending_draft_count: number;
  last_message_at: string;
  last_from: string | null;
}

export interface Message {
  id: number;
  thread_id: number;
  direction: "inbound" | "outbound";
  sent_by: "external" | "human" | "agent";
  from_address: string;
  from_name: string | null;
  to_addresses: string;
  subject: string;
  text_body: string | null;
  html_body: string | null;
  is_auto_submitted: number;
  created_at: string;
}

export interface Draft {
  id: number;
  thread_id: number;
  text_body: string;
  created_by: "human" | "agent";
  agent_notes: string | null;
  playbook_id: number | null;
  playbook_name: string | null;
  status: "pending" | "sent" | "discarded";
  created_at: string;
}

export interface ThreadDetail {
  thread: ThreadSummary;
  messages: Message[];
  drafts: Draft[];
}
