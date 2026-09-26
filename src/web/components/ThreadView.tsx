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
  ChevronDownIcon,
  InboxIcon,
  PaperclipIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from "./Icons";
import { LinkifiedText } from "./LinkifiedText";

export function ThreadView(props: {
  threadId: number;
  onBack: () => void;
  onArchived: () => void;
}) {
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [failedAttemptKey, setFailedAttemptKey] = useState<string | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    setPendingFiles([]);
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
    mutationFn: (args: {
      text: string;
      attemptId: string;
      attemptKey: string;
      draftId?: number;
      files?: File[];
    }) =>
      sendReply(props.threadId, args.text, args.attemptId, args.draftId, args.files ?? []),
    onSuccess: (result, args) => {
      if (result.status === "sent" && args.draftId === undefined) {
        setReplyText("");
        setPendingFiles([]);
      }
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
      <div className="flex h-full flex-col bg-canvas">
        <div className="flex h-16 items-center border-b bg-background px-4 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={props.onBack}
            className="-ml-1"
            aria-label="Back to conversations"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <InboxIcon className="h-[18px] w-[18px]" />
          </span>
          <p className="mt-3 text-[13px] font-medium text-foreground">Couldn’t open this conversation</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            It may have been archived or deleted, or the connection dropped.
          </p>
          <Button variant="outline" onClick={() => detail.refetch()} className="mt-4">
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
    if ((text || pendingFiles.length > 0) && !reply.isPending) {
      const fingerprint = `${text} ${pendingFiles.map((file) => `${file.name}:${file.size}`).join(",")}`;
      reply.mutate({
        text,
        files: pendingFiles,
        attemptId: attemptFor("manual", fingerprint),
        attemptKey: "manual",
      });
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setPendingFiles((current) => [...current, ...list].slice(0, 10));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-canvas">
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b bg-background px-4 py-2.5 md:px-6">
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
          <h1
            className="truncate text-[15px] font-semibold tracking-[-0.015em] text-foreground"
            title={thread.subject || undefined}
          >
            {thread.subject || "(no subject)"}
          </h1>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{thread.mailbox_address}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0 tabular-nums">
              {thread.message_count} {thread.message_count === 1 ? "message" : "messages"}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => archive.mutate()}
          disabled={archive.isPending}
          aria-label="Archive conversation"
          className="shrink-0"
        >
          <ArchiveIcon className="h-4 w-4" />
          <span className="hidden sm:inline">{archive.isPending ? "Archiving…" : "Archive"}</span>
        </Button>
      </header>

      <div ref={conversationRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mr-auto w-full max-w-[800px] space-y-3 px-4 py-5 sm:px-6 md:py-6">
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

      <footer className="shrink-0 bg-canvas px-4 pt-1 pb-3 sm:px-6 sm:pb-5">
        <div className="mr-auto w-full max-w-[800px]">
          <Card className="gap-0 py-0 shadow-[0_1px_2px_oklch(0.2_0.012_265/0.04),0_4px_16px_-6px_oklch(0.2_0.012_265/0.08)] transition-shadow focus-within:ring-foreground/25">
            <div className="flex min-w-0 items-center gap-1.5 border-b border-border/70 px-3.5 py-2 text-xs text-muted-foreground">
              <span className="shrink-0">Replying from</span>
              <span className="truncate font-medium text-foreground/80">{thread.mailbox_address}</span>
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
              aria-label="Reply"
              className="max-h-[40dvh] min-h-[84px] resize-none rounded-none border-0 bg-transparent px-3.5 py-3 text-sm leading-6 shadow-none focus-visible:ring-0 md:text-sm"
            />
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3.5 pb-1" aria-label="Attachments to send">
                {pendingFiles.map((file, index) => (
                  <span
                    key={`${file.name}-${index}`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 py-1 pr-1 pl-2 text-xs text-foreground"
                  >
                    <PaperclipIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">{file.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatFileSize(file.size)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() =>
                        setPendingFiles((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-end px-3 pb-3 sm:justify-between">
              <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>Enter</Kbd>
                <span className="ml-0.5">to send</span>
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => addFiles(event.target.files)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  aria-label="Attach files"
                  title="Attach files"
                  disabled={reply.isPending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <PaperclipIcon className="h-4 w-4" />
                </Button>
                <Button
                  onClick={submitReply}
                  disabled={
                    (!replyText.trim() && pendingFiles.length === 0) || reply.isPending
                  }
                >
                  <SendIcon className="h-3.5 w-3.5" />
                  {reply.isPending ? "Sending…" : "Send reply"}
                </Button>
              </div>
            </div>
          </Card>
          {reply.isError && (
            <div
              role="alert"
              className="mt-2 flex items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive"
            >
              <p className="min-w-0 flex-1">
                {reply.error instanceof Error ? reply.error.message : "The reply could not be sent."}
                {" "}Your text is still here. Check Email Logs before creating a new send attempt.
              </p>
              {failedAttemptKey && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-foreground"
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
            <div
              role="status"
              className="mt-2 rounded-lg border bg-background px-3 py-2 text-xs leading-5 text-muted-foreground"
            >
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
      <div className="mb-3 flex items-start gap-3">
        <EmailAvatar
          email={message.from_address}
          label={displayName}
          fallback={message.sent_by === "agent" ? <SparklesIcon className="h-4 w-4" /> : undefined}
          className={`h-9 w-9 text-[13px] ${isOutbound ? "bg-muted text-foreground/70" : ""}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold text-foreground">{displayName}</span>
            {message.sent_by === "agent" && <AuthorBadge tone="agent">Agent</AuthorBadge>}
            {isOutbound && message.sent_by === "human" && <AuthorBadge tone="human">You</AuthorBadge>}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {isOutbound ? `to ${JSON.parse(message.to_addresses || "[]").join(", ")}` : message.from_address}
          </div>
        </div>
        <time
          dateTime={message.created_at}
          className="mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground"
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
        <div className="max-w-[72ch] break-words text-sm leading-6 whitespace-pre-wrap text-foreground">
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
              className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
            variant="ghost"
            size="xs"
            onClick={() => setShowQuoted((visible) => !visible)}
            aria-expanded={showQuoted}
            className="-ml-2 text-muted-foreground"
          >
            {showQuoted ? "Hide quoted text" : "Show quoted text"}
          </Button>
          {showQuoted && (
            <div className="mt-2 break-words border-l border-border pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
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
        failed ? "border-destructive/15 bg-destructive/5" : "border-border/70 bg-muted/40"
      }`}
    >
      <span className={`mt-0.5 shrink-0 sm:mt-0 ${failed ? "text-destructive" : "text-muted-foreground"}`}>
        <SparklesIcon className={`h-3.5 w-3.5 ${working ? "animate-pulse" : ""}`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-medium ${failed ? "text-destructive" : "text-foreground"}`}>
          {state.title}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{state.detail}</p>
      </div>
      {failed && props.run && (
        <Button variant="outline" size="sm" className="shrink-0" onClick={props.onRetry} disabled={props.retrying}>
          {props.retrying ? "Retrying…" : "Try again"}
        </Button>
      )}
      {props.status === "off" && (
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link to={props.settingsHref}>Open settings</Link>
        </Button>
      )}
      {props.status === "not_processed" && (
        <Button variant="outline" size="sm" className="shrink-0" onClick={props.onStart} disabled={props.starting}>
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

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

function Kbd(props: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted/50 px-1 font-sans text-[11px] font-medium text-muted-foreground">
      {props.children}
    </kbd>
  );
}

function AuthorBadge(props: { tone: "agent" | "human"; children: React.ReactNode }) {
  return (
    <Badge
      variant={props.tone === "agent" ? "outline" : "secondary"}
      className="h-5 rounded-md px-1.5 text-[11px] font-medium"
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
    <Card className="gap-0 py-0 shadow-[0_1px_2px_oklch(0.2_0.012_265/0.04),0_6px_20px_-8px_oklch(0.2_0.012_265/0.12)] ring-foreground/20">
      <CardHeader className="flex flex-row items-center gap-3 border-b bg-muted/40 px-4 py-3 sm:px-5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <SparklesIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold text-foreground">Agent draft</span>
            <Badge variant="outline" className="h-5 rounded-md bg-background px-1.5 text-[11px] font-medium">
              Needs review
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {props.draft.playbook_name ? (
              <>
                Playbook: <span className="font-medium text-foreground/80">{props.draft.playbook_name}</span>
              </>
            ) : (
              "No playbook"
            )}
          </p>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5">
        {props.draft.agent_notes && (
          <details className="group mb-3 rounded-lg border bg-muted/30">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground outline-none transition-colors marker:hidden hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
              <ChevronDownIcon className="h-3.5 w-3.5 -rotate-90 transition-transform group-open:rotate-0" />
              Agent context
            </summary>
            <p className="px-3 pb-3 pl-8 text-[12.5px] leading-5 text-muted-foreground">{props.draft.agent_notes}</p>
          </details>
        )}
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={7}
          aria-label="Draft reply"
          className="min-h-40 w-full resize-y bg-background px-3 py-2.5 text-sm leading-6 md:text-sm"
        />
        <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={props.onDiscard}
              disabled={props.discarding || props.sending}
            >
              {props.discarding ? "Discarding…" : "Discard"}
            </Button>
            <Button
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
    <div className="flex h-full flex-col bg-canvas" aria-busy="true" aria-label="Loading conversation">
      <div className="flex h-16 items-center gap-3 border-b bg-background px-4 md:px-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="-ml-1 md:hidden"
          aria-label="Back to conversations"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </Button>
        <div className="space-y-2">
          <div className="h-3.5 w-56 animate-pulse rounded bg-muted" />
          <div className="h-2.5 w-32 animate-pulse rounded bg-muted/70" />
        </div>
      </div>
      <div className="mr-auto w-full max-w-[800px] space-y-3 px-4 py-5 sm:px-6 md:py-6">
        {[0, 1].map((item) => (
          <Card key={item} className="animate-pulse p-5">
            <div className="flex items-center gap-3">
              <span className="h-9 w-9 rounded-full bg-muted" />
              <span className="h-3 w-36 rounded bg-muted" />
            </div>
            <div className="mt-5 space-y-2">
              <span className="block h-3 w-full rounded bg-muted" />
              <span className="block h-3 w-4/5 rounded bg-muted" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
