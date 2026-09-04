import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  archiveThread,
  createDraft,
  discardDraft,
  fetchThread,
  markRead,
  retryDraftRun,
  sendReply,
} from "../api";
import type { Draft, DraftRun, Message } from "../../shared/types";
import {
  deriveAgentDraftStatus,
  type AgentDraftStatus,
} from "../../shared/agent-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatTime, splitQuotedTail } from "../lib";
import { EmailAvatar } from "./EmailAvatar";
import { EmailHtmlBody } from "./EmailHtmlBody";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  InboxIcon,
  PaperclipIcon,
  SendIcon,
  SparklesIcon,
} from "./Icons";
import { LinkifiedText } from "./LinkifiedText";

export function ThreadView(props: {
  threadId: number;
  onBack: () => void;
  onArchived: () => void;
}) {
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [failedAttemptKey, setFailedAttemptKey] = useState<string | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const attemptIds = useRef(new Map<string, { text: string; id: string }>());

  const detail = useQuery({
    queryKey: ["thread", props.threadId],
    queryFn: () => fetchThread(props.threadId),
    refetchInterval: (query) => {
      const status = query.state.data?.draft_run?.status;
      return status === "queued" || status === "generating" ? 3_000 : 30_000;
    },
  });

  useEffect(() => {
    markRead(props.threadId).then(() => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["mailboxes"] });
    });
    setReplyText("");
    setSendNotice(null);
    setFailedAttemptKey(null);
    attemptIds.current.clear();
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
    mutationFn: (args: { text: string; attemptId: string; attemptKey: string; draftId?: number }) =>
      sendReply(props.threadId, args.text, args.attemptId, args.draftId),
    onSuccess: (result, args) => {
      if (result.status === "sent" && args.draftId === undefined) setReplyText("");
      setFailedAttemptKey(null);
      setSendNotice(
        result.status === "sending"
          ? "The provider accepted this send request, but confirmation is still pending. It will not be sent again automatically."
          : null,
      );
      invalidateAll();
    },
    onError: (_error, args) => setFailedAttemptKey(args.attemptKey),
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

  const retryDraft = useMutation({
    mutationFn: (runId: number) => retryDraftRun(runId),
    onSuccess: invalidateAll,
  });

  const startDraft = useMutation({
    mutationFn: () => createDraft(props.threadId),
    onSuccess: invalidateAll,
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
  const agentStatus = deriveAgentDraftStatus({
    pendingDraftCount: drafts.length,
    runStatus: detail.data.draft_run?.status ?? null,
    agentMode: thread.mailbox_agent_mode,
    latestInboundIsAutomated: Boolean(thread.latest_inbound_is_auto_submitted),
    lastMessageDirection: thread.last_message_direction,
  });
  const latestInboundMessageId = [...messages]
    .reverse()
    .find((message) => message.direction === "inbound")?.id;

  const attemptFor = (key: string, text: string) => {
    const existing = attemptIds.current.get(key);
    if (existing?.text === text) return existing.id;
    const id = crypto.randomUUID();
    attemptIds.current.set(key, { text, id });
    return id;
  };

  const submitReply = () => {
    const text = replyText.trim();
    if (text && !reply.isPending) {
      reply.mutate({ text, attemptId: attemptFor("manual", text), attemptKey: "manual" });
    }
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
            <MessageCard
              key={message.id}
              message={message}
              agentState={
                drafts.length === 0 && message.id === latestInboundMessageId
                  ? {
                      status: agentStatus,
                      run: detail.data.draft_run,
                      settingsHref: `/settings/inboxes/${thread.mailbox_id}`,
                      retrying: retryDraft.isPending,
                      starting: startDraft.isPending,
                      startError:
                        startDraft.isError && startDraft.error instanceof Error
                          ? startDraft.error.message
                          : null,
                      onRetry: () => {
                        if (detail.data.draft_run) retryDraft.mutate(detail.data.draft_run.id);
                      },
                      onStart: () => startDraft.mutate(),
                    }
                  : null
              }
            />
          ))}
          {drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              sending={reply.isPending}
              discarding={discard.isPending}
              onSend={(text) =>
                reply.mutate({
                  text,
                  draftId: draft.id,
                  attemptKey: `draft-${draft.id}`,
                  attemptId: attemptFor(`draft-${draft.id}`, text.trim()),
                })
              }
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
            <div className="mt-2 flex items-center gap-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700">
              <p className="min-w-0 flex-1">
                {reply.error instanceof Error ? reply.error.message : "The reply could not be sent."}
                {" "}Your text is still here. Check Email Logs before creating a new send attempt.
              </p>
              {failedAttemptKey && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 bg-white text-foreground"
                  onClick={() => {
                    attemptIds.current.delete(failedAttemptKey);
                    setFailedAttemptKey(null);
                    reply.reset();
                  }}
                >
                  New attempt
                </Button>
              )}
            </div>
          )}
          {sendNotice && (
            <div className="mt-2 rounded-lg border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              {sendNotice}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

interface MessageAgentStateProps {
  status: AgentDraftStatus;
  run: DraftRun | null;
  settingsHref: string;
  retrying: boolean;
  starting: boolean;
  startError: string | null;
  onRetry: () => void;
  onStart: () => void;
}

function MessageCard({
  message,
  agentState,
}: {
  message: Message;
  agentState: MessageAgentStateProps | null;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const isOutbound = message.direction === "outbound";
  const displayName = isOutbound
    ? message.from_name || message.from_address
    : message.from_name || message.from_address;
  const { main, quoted } = splitQuotedTail(message.text_body ?? "");

  return (
    <Card className="gap-0 p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-3">
        <EmailAvatar
          email={message.from_address}
          label={displayName}
          fallback={message.sent_by === "agent" ? <SparklesIcon className="h-4 w-4" /> : undefined}
          className={`h-9 w-9 text-[12px] ${
            isOutbound ? "bg-slate-200 text-slate-700" : ""
          }`}
        />
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

      {message.html_body ? (
        <EmailHtmlBody
          html={message.html_body}
          attachments={message.attachments}
          sender={displayName}
        />
      ) : (
        <div className="break-words text-[13.5px] leading-6 whitespace-pre-wrap text-slate-800">
          <LinkifiedText text={main} />
        </div>
      )}
      {message.attachments.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Attachments">
          {message.attachments.map((attachment) => (
            <a
              key={attachment.id}
              href={`/api/attachments/${attachment.id}`}
              download={attachment.filename || undefined}
              className="inline-flex max-w-full items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-[11px] text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PaperclipIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{attachment.filename || "Attachment"}</span>
              <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.size)}</span>
            </a>
          ))}
        </div>
      )}
      {!message.html_body && quoted && (
        <div className="mt-3">
          <Button
            variant="outline"
            size="xs"
            onClick={() => setShowQuoted((visible) => !visible)}
          >
            {showQuoted ? "Hide quoted text" : "Show quoted text"}
          </Button>
          {showQuoted && (
            <div className="mt-3 break-words border-l-2 border-slate-200 pl-3 text-[12px] leading-relaxed whitespace-pre-wrap text-slate-400">
              <LinkifiedText text={quoted} />
            </div>
          )}
        </div>
      )}
      {agentState && <MessageAgentState {...agentState} />}
    </Card>
  );
}

function MessageAgentState(props: MessageAgentStateProps) {
  if (props.status === "none" || props.status === "draft_ready") return null;

  const content: Partial<Record<AgentDraftStatus, { title: string; detail: string }>> = {
    processing: {
      title: "AI is preparing a draft",
      detail: "This conversation updates automatically when the draft is ready.",
    },
    failed: {
      title: "AI couldn’t create a draft",
      detail: props.run?.error || "The model did not return a draft.",
    },
    skipped: {
      title: "AI skipped this message",
      detail:
        props.run?.error ||
        "Automated messages and messages replaced by a newer reply are not drafted.",
    },
    off: {
      title: "AI drafting is off",
      detail: "Turn it on for this inbox in Settings to draft future replies.",
    },
    not_processed: {
      title: "Not processed by AI",
      detail: props.startError || "AI never started on this message.",
    },
    processed: {
      title: "AI processing is complete",
      detail: "There is no draft awaiting review.",
    },
  };
  const state = content[props.status];
  if (!state) return null;
  const working = props.status === "processing";
  const failed = props.status === "failed";

  return (
    <div
      className={`-mx-4 -mb-4 mt-4 flex items-start gap-2.5 border-t px-4 py-3 sm:-mx-5 sm:-mb-5 sm:items-center sm:px-5 ${
        failed ? "border-red-100 bg-red-50/60" : "bg-muted/30"
      }`}
    >
      <span className={`mt-0.5 shrink-0 ${failed ? "text-red-700" : "text-muted-foreground"}`}>
        <SparklesIcon className={`h-3.5 w-3.5 ${working ? "animate-pulse" : ""}`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-medium text-foreground">{state.title}</p>
        <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">{state.detail}</p>
      </div>
      {failed && props.run && (
        <Button variant="outline" size="xs" onClick={props.onRetry} disabled={props.retrying}>
          {props.retrying ? "Retrying…" : "Try again"}
        </Button>
      )}
      {props.status === "off" && (
        <Button asChild variant="outline" size="xs">
          <Link to={props.settingsHref}>Open settings</Link>
        </Button>
      )}
      {props.status === "not_processed" && (
        <Button variant="outline" size="xs" onClick={props.onStart} disabled={props.starting}>
          {props.starting ? "Creating…" : "Create draft"}
        </Button>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
