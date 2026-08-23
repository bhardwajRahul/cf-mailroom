import { useDeferredValue, useEffect, useRef } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { fetchMailboxes, fetchThreads, searchThreads } from "./api";
import { AgentSettings } from "./components/AgentSettings";
import { InboxIcon } from "./components/Icons";
import { Sidebar } from "./components/Sidebar";
import { ThreadList, type ThreadFilter } from "./components/ThreadList";
import { ThreadView } from "./components/ThreadView";

type WorkspaceView = "inbox" | "settings";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/inbox" replace />} />
      <Route path="/inbox" element={<Workspace view="inbox" />} />
      <Route path="/inbox/:threadId" element={<Workspace view="inbox" />} />
      <Route path="/mailboxes/:mailboxId" element={<Workspace view="inbox" mailboxScoped />} />
      <Route
        path="/mailboxes/:mailboxId/threads/:threadId"
        element={<Workspace view="inbox" mailboxScoped />}
      />
      <Route path="/settings" element={<Workspace view="settings" />} />
      <Route path="/settings/inboxes/:mailboxId" element={<Workspace view="settings" />} />
      <Route path="*" element={<Navigate to="/inbox" replace />} />
    </Routes>
  );
}

function Workspace(props: {
  view: WorkspaceView;
  mailboxScoped?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ mailboxId?: string; threadId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const autoSelectedScope = useRef<string | null>(null);

  const routeMailboxId = parseId(params.mailboxId);
  const selectedMailbox = props.mailboxScoped || props.view === "settings" ? routeMailboxId : null;
  const selectedThread = parseId(params.threadId);
  const search = searchParams.get("q") ?? "";
  const filter = parseFilter(searchParams.get("filter"));
  const deferredSearch = useDeferredValue(search.trim());

  const mailboxes = useQuery({ queryKey: ["mailboxes"], queryFn: fetchMailboxes });
  const threads = useQuery({
    queryKey: ["threads", selectedMailbox, deferredSearch],
    queryFn: () =>
      deferredSearch
        ? searchThreads(deferredSearch, selectedMailbox)
        : fetchThreads(selectedMailbox),
    placeholderData: keepPreviousData,
    enabled: props.view === "inbox",
  });

  const listPath = selectedMailbox === null ? "/inbox" : `/mailboxes/${selectedMailbox}`;

  useEffect(() => {
    if (selectedThread !== null) autoSelectedScope.current = listPath;
  }, [listPath, selectedThread]);

  useEffect(() => {
    if (
      props.view === "inbox" &&
      selectedThread === null &&
      autoSelectedScope.current !== listPath &&
      threads.data?.length &&
      !threads.isPlaceholderData &&
      window.matchMedia("(min-width: 768px)").matches
    ) {
      autoSelectedScope.current = listPath;
      navigate(
        { pathname: threadPath(selectedMailbox, threads.data[0].id), search: location.search },
        { replace: true },
      );
    }
  }, [
    listPath,
    location.search,
    navigate,
    props.view,
    selectedMailbox,
    selectedThread,
    threads.data,
    threads.isPlaceholderData,
  ]);

  useEffect(() => {
    if (
      props.view !== "settings" ||
      selectedMailbox !== null ||
      !mailboxes.data?.length
    ) return;
    const defaultMailbox =
      mailboxes.data.find((mailbox) => mailbox.agent_mode !== "off") ?? mailboxes.data[0];
    navigate(`/settings/inboxes/${defaultMailbox.id}`, { replace: true });
  }, [mailboxes.data, navigate, props.view, selectedMailbox]);

  const selectMailbox = (id: number | null) => {
    navigate(id === null ? "/inbox" : `/mailboxes/${id}`);
  };

  const openSettings = () => {
    const mailboxId =
      selectedMailbox ??
      mailboxes.data?.find((mailbox) => mailbox.agent_mode !== "off")?.id ??
      mailboxes.data?.[0]?.id;
    navigate(mailboxId ? `/settings/inboxes/${mailboxId}` : "/settings");
  };

  const updateQuery = (key: "q" | "filter", value: string, defaultValue = "") => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (!value || value === defaultValue) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };

  const selectedMailboxName =
    selectedMailbox === null
      ? "All inboxes"
      : (mailboxes.data?.find((mailbox) => mailbox.id === selectedMailbox)?.address ??
        "Inbox");

  return (
    <div className="flex h-dvh min-h-[560px] overflow-hidden bg-background text-foreground antialiased">
      <Sidebar
        mailboxes={mailboxes.data ?? []}
        selected={selectedMailbox}
        activeView={props.view}
        onSelect={selectMailbox}
        onOpenSettings={openSettings}
      />

      {props.view === "settings" ? (
        <main className="min-w-0 flex-1 overflow-hidden">
          <AgentSettings
            mailboxes={mailboxes.data ?? []}
            mailboxId={selectedMailbox}
            onSelectMailbox={(id) => navigate(`/settings/inboxes/${id}`)}
            onBack={() => navigate("/inbox")}
          />
        </main>
      ) : (
        <>
          <ThreadList
            mailboxes={mailboxes.data ?? []}
            threads={threads.data ?? []}
            title={selectedMailboxName}
            selected={selectedThread}
            selectedMailbox={selectedMailbox}
            showMailboxChip={selectedMailbox === null}
            search={search}
            filter={filter}
            loading={threads.isLoading}
            fetching={threads.isFetching}
            error={threads.isError}
            detailsOpen={selectedThread !== null}
            onSearch={(query) => updateQuery("q", query)}
            onFilter={(nextFilter) => updateQuery("filter", nextFilter, "all")}
            onSelectMailbox={selectMailbox}
            onOpenSettings={openSettings}
            onSelect={(id) =>
              navigate({ pathname: threadPath(selectedMailbox, id), search: location.search })
            }
          />
          <main
            className={`min-w-0 flex-1 overflow-hidden ${selectedThread === null ? "hidden md:block" : "block"}`}
          >
            {selectedThread !== null ? (
              <ThreadView
                threadId={selectedThread}
                onBack={() => navigate({ pathname: listPath, search: location.search })}
                onArchived={() => navigate({ pathname: listPath, search: location.search })}
              />
            ) : (
              <div className="h-full bg-muted/20 px-6 py-10">
                <span className="flex h-12 w-12 items-center justify-center rounded-lg border bg-background text-muted-foreground">
                  <InboxIcon className="h-6 w-6" />
                </span>
                <div className="mt-3 text-left">
                  <p className="text-sm font-medium text-slate-600">Choose a conversation</p>
                </div>
              </div>
            )}
          </main>
        </>
      )}
    </div>
  );
}

function parseId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseFilter(value: string | null): ThreadFilter {
  return value === "unread" || value === "drafts" ? value : "all";
}

function threadPath(mailboxId: number | null, threadId: number): string {
  return mailboxId === null
    ? `/inbox/${threadId}`
    : `/mailboxes/${mailboxId}/threads/${threadId}`;
}
