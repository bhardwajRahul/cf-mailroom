import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { archiveThread, discardDraft, fetchThread, markRead, sendReply } from "../api";
import type { Draft, Message } from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { avatarClass, formatTime, initialOf, splitQuotedTail } from "../lib";
import { ArchiveIcon, ArrowLeftIcon, InboxIcon, SendIcon, SparklesIcon } from "./Icons";

export function ThreadView(props: {
  threadId: number;
  onBack: () => void;
  onArchived: () => void;
}) {
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const conversationRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!detail.data) return;
    requestAnimationFrame(() => {
      const container = conversationRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
  }, [detail.data, props.threadId]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["thread", props.threadId] });
    queryClient.invalidateQueries({ queryKey: ["threads"] });
    queryClient.invalidateQueries({ queryKey: ["mailboxes"] });
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

  if (detail.isLoading) return <ThreadViewSkeleton onBack={props.onBack} />;

  if (detail.isError || !detail.data) {
    return (
      <div className="flex h-full flex-col bg-muted/20">
        <div className="flex h-16 items-center border-b bg-background px-4 md:px-6">
          <Button variant="ghost" size="icon" onClick={props.onBack} className="mr-2 md:hidden">
            <ArrowLeftIcon />
          </Button>
        </div>
        <div className="flex flex-1 flex-col items-start px-6 py-10 text-left">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400">
            <InboxIcon className="h-5 w-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-slate-700">Couldn’t open this conversation</p>
          <Button
            onClick={() => detail.refetch()}
            className="mt-3"
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const { thread, messages, drafts } = detail.data;

  const submitReply = () => {
    if (replyText.trim() && !reply.isPending) reply.mutate({ text: replyText });
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-muted/20">
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b bg-background px-4 md:px-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={props.onBack}
          className="-ml-1 md:hidden"
          aria-label="Back to conversations"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[16px] font-semibold tracking-[-0.015em] text-slate-950">
            {thread.subject || "(no subject)"}
          </h1>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-slate-400">
            <span className="inline-flex min-w-0 items-center rounded-md bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
              <span className="truncate">{thread.mailbox_address}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">
              {thread.message_count} {thread.message_count === 1 ? "message" : "messages"}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => archive.mutate()}
          disabled={archive.isPending}
          className="h-9"
        >
          <ArchiveIcon className="h-4 w-4" />
          <span className="hidden sm:inline">{archive.isPending ? "Archiving…" : "Archive"}</span>
        </Button>
      </header>

      <div ref={conversationRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mr-auto w-full max-w-[800px] space-y-4 px-4 py-5 sm:px-6 md:py-6">
          {messages.map((message) => (
            <MessageCard key={message.id} message={message} />
          ))}
          {drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              sending={reply.isPending}
              discarding={discard.isPending}
              onSend={(text) => reply.mutate({ text, draftId: draft.id })}
              onDiscard={() => discard.mutate(draft.id)}
            />
          ))}
        </div>
      </div>

      <footer className="shrink-0 border-t bg-background px-4 py-3 sm:px-6 sm:py-4">
        <div className="mr-auto w-full max-w-[800px]">
          <Card className="gap-0 py-0">
            <div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2 text-[10.5px] text-slate-400">
              <span>Replying from</span>
              <span className="font-medium text-slate-600">{thread.mailbox_address}</span>
            </div>
            <Textarea
              value={replyText}
              onChange={(event) => setReplyText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submitReply();
                }
              }}
              placeholder="Write a reply…"
              rows={3}
              className="min-h-[80px] resize-none rounded-none border-0 bg-transparent px-3.5 py-3 text-[13px] shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-end px-3 pb-3 sm:justify-between">
              <span className="hidden text-[10px] text-muted-foreground sm:inline">⌘ Enter to send</span>
              <Button
                onClick={submitReply}
                disabled={!replyText.trim() || reply.isPending}
                size="sm"
              >
                <SendIcon className="h-3.5 w-3.5" />
                {reply.isPending ? "Sending…" : "Send reply"}
              </Button>
            </div>
          </Card>
          {reply.isError && (
            <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700">
              Failed to send. Your reply is still here — please try again.
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

function MessageCard({ message }: { message: Message }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const isOutbound = message.direction === "outbound";
  const displayName = isOutbound
    ? message.from_name || message.from_address
    : message.from_name || message.from_address;
  const { main, quoted } = splitQuotedTail(message.text_body ?? "");

  return (
    <Card className="gap-0 p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
            isOutbound ? "bg-slate-200 text-slate-700" : avatarClass(message.from_address)
          }`}
        >
          {message.sent_by === "agent" ? <SparklesIcon className="h-4 w-4" /> : initialOf(displayName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-slate-800">{displayName}</span>
            {message.sent_by === "agent" && <AuthorBadge tone="agent">Agent</AuthorBadge>}
            {isOutbound && message.sent_by === "human" && <AuthorBadge tone="human">You</AuthorBadge>}
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-slate-400">
            {isOutbound ? `to ${JSON.parse(message.to_addresses || "[]").join(", ")}` : message.from_address}
          </div>
        </div>
        <time
          className="shrink-0 text-[10.5px] tabular-nums text-slate-400"
          title={new Date(message.created_at).toLocaleString()}
        >
          {formatTime(message.created_at)}
        </time>
      </div>

      <div className="text-[13.5px] leading-6 whitespace-pre-wrap text-slate-800">{main}</div>
      {quoted && (
        <div className="mt-3">
          <Button
            variant="outline"
            size="xs"
            onClick={() => setShowQuoted((visible) => !visible)}
          >
            {showQuoted ? "Hide quoted text" : "Show quoted text"}
          </Button>
          {showQuoted && (
            <div className="mt-3 border-l-2 border-slate-200 pl-3 text-[12px] leading-relaxed whitespace-pre-wrap text-slate-400">
              {quoted}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function AuthorBadge(props: { tone: "agent" | "human"; children: React.ReactNode }) {
  return (
    <Badge
      variant={props.tone === "agent" ? "outline" : "secondary"}
      className="h-5 px-1.5 text-[9px] tracking-wide uppercase"
    >
      {props.children}
    </Badge>
  );
}

function DraftCard(props: {
  draft: Draft;
  sending: boolean;
  discarding: boolean;
  onSend: (text: string) => void;
  onDiscard: () => void;
}) {
  const [text, setText] = useState(props.draft.text_body);

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-row items-center gap-3 border-b bg-muted/30 px-4 py-3 sm:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border bg-background text-foreground">
          <SparklesIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-900">Agent draft</span>
            <Badge variant="secondary" className="h-5 px-1.5 text-[9px] font-normal">
              Needs review
            </Badge>
          </div>
          <p className="mt-0.5 text-[10.5px] text-slate-500">
            {props.draft.playbook_name ? (
              <>
                Playbook: <span className="font-semibold">{props.draft.playbook_name}</span>
              </>
            ) : (
              "No playbook"
            )}
          </p>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5">
        {props.draft.agent_notes && (
          <details className="group mb-3 rounded-lg border bg-muted/30 px-3 py-2.5">
            <summary className="cursor-pointer list-none text-[10.5px] font-semibold text-slate-500 marker:hidden">
              <span className="inline-flex items-center gap-1.5">
                <SparklesIcon className="h-3.5 w-3.5 text-slate-500" />
                Agent context
              </span>
            </summary>
            <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">{props.draft.agent_notes}</p>
          </details>
        )}
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={7}
          className="min-h-40 w-full resize-y text-[13.5px] leading-6"
        />
        <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onDiscard}
              disabled={props.discarding || props.sending}
            >
              {props.discarding ? "Discarding…" : "Discard"}
            </Button>
            <Button
              size="sm"
              onClick={() => props.onSend(text)}
              disabled={!text.trim() || props.sending || props.discarding}
            >
              <SendIcon className="h-3.5 w-3.5" />
              {props.sending ? "Sending…" : "Approve & send"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ThreadViewSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-full flex-col bg-muted/20">
      <div className="flex h-16 items-center border-b bg-background px-4 md:px-6">
        <Button variant="ghost" size="icon" onClick={onBack} className="mr-2 md:hidden">
          <ArrowLeftIcon />
        </Button>
        <div className="h-4 w-48 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="mr-auto w-full max-w-[800px] space-y-4 px-4 py-6 sm:px-6">
        {[0, 1].map((item) => (
          <Card key={item} className="animate-pulse p-5">
            <div className="flex items-center gap-3">
              <span className="h-9 w-9 rounded-full bg-slate-100" />
              <span className="h-3 w-36 rounded bg-slate-100" />
            </div>
            <div className="mt-5 space-y-2">
              <span className="block h-3 w-full rounded bg-slate-100" />
              <span className="block h-3 w-4/5 rounded bg-slate-100" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
