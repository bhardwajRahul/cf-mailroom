import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { archiveThread, discardDraft, fetchThread, markRead, sendReply } from "../api";
import type { Draft, Message } from "../../shared/types";

export function ThreadView(props: { threadId: number; onArchived: () => void }) {
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");

  const detail = useQuery({
    queryKey: ["thread", props.threadId],
    queryFn: () => fetchThread(props.threadId),
  });

  useEffect(() => {
    markRead(props.threadId).then(() => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["mailboxes"] });
    });
    setReplyText("");
  }, [props.threadId, queryClient]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["thread", props.threadId] });
    queryClient.invalidateQueries({ queryKey: ["threads"] });
  };

  const reply = useMutation({
    mutationFn: (args: { text: string; draftId?: number }) =>
      sendReply(props.threadId, args.text, args.draftId),
    onSuccess: () => {
      setReplyText("");
      invalidateAll();
    },
  });

  const discard = useMutation({
    mutationFn: (draftId: number) => discardDraft(draftId),
    onSuccess: invalidateAll,
  });

  const archive = useMutation({
    mutationFn: () => archiveThread(props.threadId),
    onSuccess: () => {
      invalidateAll();
      props.onArchived();
    },
  });

  if (!detail.data) {
    return <div className="p-6 text-sm text-gray-400">Loading…</div>;
  }
  const { thread, messages, drafts } = detail.data;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-gray-200 px-6 py-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: thread.mailbox_color }} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{thread.subject || "(no subject)"}</h1>
          <div className="text-xs text-gray-500">via {thread.mailbox_address}</div>
        </div>
        <button
          onClick={() => archive.mutate()}
          className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
        >
          Archive
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {messages.map((m) => (
          <MessageCard key={m.id} message={m} />
        ))}
        {drafts.map((d) => (
          <DraftCard
            key={d.id}
            draft={d}
            sending={reply.isPending}
            onSend={(text) => reply.mutate({ text, draftId: d.id })}
            onDiscard={() => discard.mutate(d.id)}
          />
        ))}
      </div>

      <footer className="border-t border-gray-200 p-4">
        <textarea
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder={`Reply as ${thread.mailbox_address}…`}
          rows={3}
          className="w-full resize-none rounded-md border border-gray-300 p-2 text-sm focus:border-indigo-400 focus:outline-none"
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={() => reply.mutate({ text: replyText })}
            disabled={!replyText.trim() || reply.isPending}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {reply.isPending ? "Sending…" : "Send"}
          </button>
        </div>
        {reply.isError && (
          <div className="mt-2 text-xs text-red-600">Failed to send: {String(reply.error)}</div>
        )}
      </footer>
    </div>
  );
}

function MessageCard({ message }: { message: Message }) {
  const isOutbound = message.direction === "outbound";
  return (
    <article className={`rounded-lg border p-4 ${isOutbound ? "border-indigo-100 bg-indigo-50/50" : "border-gray-200"}`}>
      <div className="mb-2 flex items-baseline gap-2 text-xs text-gray-500">
        <span className="font-medium text-gray-800">
          {message.from_name || message.from_address}
        </span>
        {message.sent_by === "agent" && (
          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
            AGENT
          </span>
        )}
        <span className="flex-1" />
        <span>{new Date(message.created_at).toLocaleString()}</span>
      </div>
      <div className="text-sm whitespace-pre-wrap">{message.text_body}</div>
    </article>
  );
}

function DraftCard(props: {
  draft: Draft;
  sending: boolean;
  onSend: (text: string) => void;
  onDiscard: () => void;
}) {
  const [text, setText] = useState(props.draft.text_body);
  return (
    <article className="rounded-lg border-2 border-dashed border-purple-300 bg-purple-50/50 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="rounded bg-purple-600 px-1.5 py-0.5 font-semibold text-white">
          AGENT DRAFT
        </span>
        <span className="text-gray-500">awaiting your review</span>
      </div>
      {props.draft.agent_notes && (
        <div className="mb-3 rounded bg-white/70 p-2 text-xs text-gray-600">
          <span className="font-semibold">Agent notes:</span> {props.draft.agent_notes}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        className="w-full resize-y rounded-md border border-purple-200 bg-white p-2 text-sm focus:outline-none"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          onClick={props.onDiscard}
          className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-white"
        >
          Discard
        </button>
        <button
          onClick={() => props.onSend(text)}
          disabled={!text.trim() || props.sending}
          className="rounded-md bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          Approve & Send
        </button>
      </div>
    </article>
  );
}
