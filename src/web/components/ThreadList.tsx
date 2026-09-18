import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Label, Mailbox, ThreadSummary } from "../../shared/types";
import {
  deriveAgentDraftStatus,
  type AgentDraftStatus,
} from "../../shared/agent-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { bulkUpdateThreads } from "../api";
import { formatTime } from "../lib";
import { EmailAvatar } from "./EmailAvatar";
import {
  ArchiveIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  TagIcon,
  XIcon,
} from "./Icons";

export type ThreadFilter = "all" | "unread" | "drafts";

export function ThreadList(props: {
  mailboxes: Mailbox[];
  threads: ThreadSummary[];
  labels: Label[];
  title: string;
  selected: number | null;
  selectedMailbox: number | null;
  showMailboxChip: boolean;
  search: string;
  filter: ThreadFilter;
  activeLabel: number | null;
  loading: boolean;
  fetching: boolean;
  error: boolean;
  detailsOpen: boolean;
  emptyInbox: boolean;
  onSearch: (q: string) => void;
  onFilter: (filter: ThreadFilter) => void;
  onSelectLabel: (id: number | null) => void;
  onSelectMailbox: (id: number | null) => void;
  onOpenSettings: () => void;
  onSelect: (id: number) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const visibleThreads = useMemo(() => {
    if (props.filter === "unread") return props.threads.filter((thread) => !thread.is_read);
    if (props.filter === "drafts") {
      return props.threads.filter((thread) => thread.pending_draft_count > 0);
    }
    return props.threads;
  }, [props.filter, props.threads]);

  const visibleIds = useMemo(
    () => new Set(visibleThreads.map((thread) => thread.id)),
    [visibleThreads],
  );

  useEffect(() => {
    setChecked((current) => {
      const kept = [...current].filter((id) => visibleIds.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [visibleIds]);

  const availableLabels = useMemo(
    () =>
      props.labels.filter(
        (label) =>
          props.selectedMailbox === null || label.mailbox_id === props.selectedMailbox,
      ),
    [props.labels, props.selectedMailbox],
  );

  const mailboxAddress = useMemo(
    () => new Map(props.mailboxes.map((mailbox) => [mailbox.id, mailbox.address])),
    [props.mailboxes],
  );

  const bulkUpdate = useMutation({
    mutationFn: ({ ids, action }: { ids: number[]; action: "read" | "archive" }) =>
      bulkUpdateThreads(ids, action),
    onSuccess: () => {
      setChecked(new Set());
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["mailboxes"] });
    },
  });

  const toggleChecked = (id: number, value: boolean) => {
    setChecked((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const checkedCount = checked.size;
  const allChecked = visibleThreads.length > 0 && checkedCount === visibleThreads.length;

  const unreadCount = props.threads.filter((thread) => !thread.is_read).length;
  const draftCount = props.threads.filter((thread) => thread.pending_draft_count > 0).length;

  return (
    <section
      className={`w-full shrink-0 flex-col border-r bg-background md:w-[368px] xl:w-[392px] ${
        props.detailsOpen ? "hidden md:flex" : "flex"
      }`}
    >
      <header className="border-b px-4 pt-4 pb-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="hidden min-w-0 flex-1 lg:block">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold tracking-[-0.02em] text-foreground">
                {props.title}
              </h1>
              {!props.emptyInbox && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
                  {props.threads.length}
                </Badge>
              )}
              <span
                className="relative h-4 w-4 shrink-0"
                role="status"
                aria-live="polite"
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-[1px] rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground transition-opacity ${
                    props.fetching && !props.loading ? "animate-spin opacity-100" : "opacity-0"
                  }`}
                />
                <span className="sr-only">
                  {props.fetching && !props.loading ? "Refreshing conversations" : ""}
                </span>
              </span>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-between gap-2 lg:hidden">
            <Select
              value={String(props.selectedMailbox ?? "all")}
              onValueChange={(value) =>
                props.onSelectMailbox(value === "all" ? null : Number(value))
              }
            >
              <SelectTrigger size="sm" className="min-w-0 max-w-[calc(100%-2.75rem)] text-xs">
                <SelectValue placeholder="All inboxes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All inboxes</SelectItem>
                {props.mailboxes.map((mailbox) => (
                  <SelectItem key={mailbox.id} value={String(mailbox.id)}>
                    {mailbox.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={props.onOpenSettings}
              aria-label="Open settings"
            >
              <SettingsIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!props.emptyInbox && (
          <>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={props.search}
                onChange={(event) => props.onSearch(event.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
                className="h-9 w-full bg-background pr-9 pl-9 text-[13px]"
              />
              {props.search ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => props.onSearch("")}
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
                  aria-label="Clear search"
                >
                  Esc
                </Button>
              ) : (
                <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground sm:block">
                  /
                </kbd>
              )}
            </div>

            <Tabs
              value={props.filter}
              onValueChange={(value) => props.onFilter(value as ThreadFilter)}
              className="mt-3 items-start gap-0"
            >
              <TabsList aria-label="Conversation filter">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="unread">Unread{unreadCount > 0 ? ` ${unreadCount}` : ""}</TabsTrigger>
                <TabsTrigger value="drafts">Drafts{draftCount > 0 ? ` ${draftCount}` : ""}</TabsTrigger>
              </TabsList>
            </Tabs>

            {availableLabels.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <TagIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <Select
                  value={props.activeLabel === null ? "all" : String(props.activeLabel)}
                  onValueChange={(value) =>
                    props.onSelectLabel(value === "all" ? null : Number(value))
                  }
                >
                  <SelectTrigger size="sm" className="h-7 min-w-0 flex-1 text-xs" aria-label="Filter by label">
                    <SelectValue placeholder="All labels" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All labels</SelectItem>
                    {availableLabels.map((label) => (
                      <SelectItem key={label.id} value={String(label.id)}>
                        {props.selectedMailbox === null
                          ? `${label.name} · ${mailboxAddress.get(label.mailbox_id) ?? ""}`
                          : label.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {visibleThreads.length > 0 && (
              <div className="mt-2.5 flex min-h-7 items-center gap-2">
                <Checkbox
                  checked={allChecked ? true : checkedCount > 0 ? "indeterminate" : false}
                  onCheckedChange={(value) =>
                    setChecked(value === true ? new Set(visibleThreads.map((t) => t.id)) : new Set())
                  }
                  aria-label="Select all conversations"
                />
                {checkedCount > 0 ? (
                  <>
                    <span className="text-[11.5px] text-muted-foreground">
                      {checkedCount} selected
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={bulkUpdate.isPending}
                        onClick={() =>
                          bulkUpdate.mutate({ ids: [...checked], action: "read" })
                        }
                      >
                        Mark read
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={bulkUpdate.isPending}
                        onClick={() =>
                          bulkUpdate.mutate({ ids: [...checked], action: "archive" })
                        }
                      >
                        <ArchiveIcon className="h-3.5 w-3.5" />
                        Archive
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setChecked(new Set())}
                        aria-label="Clear selection"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </>
                ) : (
                  <span className="text-[11.5px] text-muted-foreground">Select all</span>
                )}
              </div>
            )}
          </>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {props.emptyInbox && (
          <p className="px-4 py-6 text-sm text-muted-foreground">No conversations</p>
        )}

        {props.loading && <ThreadListSkeleton />}

        {props.error && !props.loading && (
          <ListState
            title="Couldn’t load conversations"
            detail="Check your connection and try again."
          />
        )}

        {!props.emptyInbox && !props.loading && !props.error && visibleThreads.length === 0 && (
          <ListState
            title={
              props.search || props.activeLabel !== null
                ? "No matching conversations"
                : props.filter === "all"
                  ? "Inbox zero"
                  : `No ${props.filter} conversations`
            }
            detail={props.search ? "Try a name, subject, or message text." : undefined}
          />
        )}

        {visibleThreads.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            selected={props.selected === thread.id}
            checked={checked.has(thread.id)}
            showMailbox={props.showMailboxChip}
            onCheckedChange={(value) => toggleChecked(thread.id, value)}
            onClick={() => props.onSelect(thread.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ThreadRow(props: {
  thread: ThreadSummary;
  selected: boolean;
  checked: boolean;
  showMailbox: boolean;
  onCheckedChange: (value: boolean) => void;
  onClick: () => void;
}) {
  const { thread } = props;
  const unread = !thread.is_read;
  const sender = thread.last_from ?? thread.mailbox_address;
  const agentStatus = deriveAgentDraftStatus({
    pendingDraftCount: thread.pending_draft_count,
    runStatus: thread.draft_run_status,
    agentMode: thread.mailbox_agent_mode,
    latestInboundIsAutomated: Boolean(thread.latest_inbound_is_auto_submitted),
    lastMessageDirection: thread.last_message_direction,
  });
  const showAgentStatus =
    agentStatus !== "none" &&
    (unread || ["processing", "draft_ready", "failed"].includes(agentStatus));

  return (
    <div
      className={`group relative flex w-full border-b transition-colors ${
        props.selected
          ? "bg-slate-100 hover:bg-slate-100"
          : unread
            ? "bg-slate-50/80 hover:bg-slate-100/80"
            : "bg-background hover:bg-muted/40"
      }`}
    >
      <span className="flex items-start pt-4 pl-3">
        <Checkbox
          checked={props.checked}
          onCheckedChange={(value) => props.onCheckedChange(value === true)}
          aria-label={`Select conversation with ${sender}`}
          className={props.checked ? "" : "opacity-50 group-hover:opacity-100 focus-visible:opacity-100"}
        />
      </span>
      <button
        onClick={props.onClick}
        className="flex min-w-0 flex-1 gap-3 py-3.5 pr-4 pl-2.5 text-left focus-visible:z-10"
      >
        <span className="sr-only">{unread ? "Unread conversation. " : "Read conversation. "}</span>
        <EmailAvatar
          email={thread.last_from_address}
          label={sender}
          className={`mt-0.5 h-8 w-8 text-[12px] transition-opacity ${
            unread ? "opacity-100" : "opacity-70"
          }`}
        />
        <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {unread && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-900"
                title="Unread"
              />
            )}
            <span
              className={`min-w-0 flex-1 truncate text-[13px] ${
                unread ? "font-semibold text-slate-950" : "font-normal text-slate-600"
              }`}
            >
              {sender}
            </span>
          </span>
          <time
            className={`shrink-0 text-[10.5px] tabular-nums ${
              unread ? "font-semibold text-slate-800" : "font-normal text-slate-400"
            }`}
          >
            {formatTime(thread.last_message_at)}
          </time>
        </span>

        <span
          className={`mt-0.5 block truncate text-[13px] ${
            unread ? "font-semibold text-slate-900" : "font-normal text-slate-600"
          }`}
        >
          {thread.subject || "(no subject)"}
        </span>
        <span
          className={`mt-0.5 block truncate text-[11.5px] leading-relaxed ${
            unread ? "font-medium text-slate-600" : "font-normal text-slate-400"
          }`}
        >
          {thread.snippet}
        </span>

        {(props.showMailbox || showAgentStatus || thread.labels.length > 0) && (
          <span className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            {props.showMailbox && (
              <Badge variant="secondary" className="h-5 min-w-0 px-1.5 text-[9.5px] font-normal">
                <span className="truncate">{thread.mailbox_address}</span>
              </Badge>
            )}
            {thread.labels.map((label) => (
              <Badge
                key={label.id}
                variant="outline"
                className="h-5 shrink-0 gap-1 px-1.5 text-[9.5px] font-normal text-muted-foreground"
              >
                <TagIcon className="h-3 w-3" />
                {label.name}
              </Badge>
            ))}
            {showAgentStatus && <AgentStatusBadge status={agentStatus} />}
          </span>
        )}
        </span>
      </button>
    </div>
  );
}

function AgentStatusBadge({ status }: { status: AgentDraftStatus }) {
  const labels: Partial<Record<AgentDraftStatus, string>> = {
    processing: "AI processing",
    draft_ready: "Draft ready",
    failed: "AI failed",
    skipped: "AI skipped",
    off: "AI off",
    not_processed: "Not processed",
    processed: "AI processed",
  };
  const label = labels[status];
  if (!label) return null;

  return (
    <Badge
      variant="outline"
      className={`h-5 shrink-0 gap-1 px-1.5 text-[9.5px] font-normal ${
        status === "failed" ? "border-red-200 text-red-700" : "text-muted-foreground"
      }`}
    >
      {(status === "processing" || status === "draft_ready") && (
        <SparklesIcon className={`h-3 w-3 ${status === "processing" ? "animate-pulse" : ""}`} />
      )}
      {label}
    </Badge>
  );
}

function ListState(props: { title: string; detail?: string }) {
  return (
    <div className="px-4 py-5 text-left">
      <p className="text-[13px] text-muted-foreground">{props.title}</p>
      {props.detail && (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{props.detail}</p>
      )}
    </div>
  );
}

function ThreadListSkeleton() {
  return (
    <div aria-label="Loading conversations">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="flex animate-pulse gap-3 border-b border-slate-100 px-4 py-4">
          <span className="h-8 w-8 shrink-0 rounded-full bg-slate-100" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-3 w-2/5 rounded bg-slate-100" />
            <span className="block h-3 w-4/5 rounded bg-slate-100" />
            <span className="block h-2.5 w-full rounded bg-slate-50" />
          </span>
        </div>
      ))}
    </div>
  );
}
