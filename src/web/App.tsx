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
import { fetchLabels, fetchMailboxes, fetchThreads, searchThreads } from "./api";
import { AgentSettings } from "./components/AgentSettings";
import { GeneralSettings } from "./components/GeneralSettings";
import { InboxIcon } from "./components/Icons";
import { Sidebar } from "./components/Sidebar";
import { ThreadList, type ThreadFilter } from "./components/ThreadList";
import { ThreadView } from "./components/ThreadView";

type WorkspaceView = "inbox" | "settings";
type SettingsSection = "general" | "inboxes";

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
      <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
      <Route
        path="/settings/general"
        element={<Workspace view="settings" settingsSection="general" />}
      />
      <Route
        path="/settings/inboxes"
        element={<Workspace view="settings" settingsSection="inboxes" />}
      />
      <Route
        path="/settings/inboxes/:mailboxId"
        element={<Workspace view="settings" settingsSection="inboxes" />}
      />
      <Route path="*" element={<Navigate to="/inbox" replace />} />
    </Routes>
  );
}

function Workspace(props: {
  view: WorkspaceView;
  mailboxScoped?: boolean;
  settingsSection?: SettingsSection;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ mailboxId?: string; threadId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const autoSelectedScope = useRef<string | null>(null);

  const routeMailboxId = parseId(params.mailboxId);
  const selectedMailbox =
    props.mailboxScoped ||
    (props.view === "settings" && props.settingsSection === "inboxes")
      ? routeMailboxId
      : null;
  const selectedThread = parseId(params.threadId);
  const search = searchParams.get("q") ?? "";
  const filter = parseFilter(searchParams.get("filter"));
  const activeLabel = parseId(searchParams.get("label") ?? undefined);
  const deferredSearch = useDeferredValue(search.trim());

  const mailboxes = useQuery({ queryKey: ["mailboxes"], queryFn: fetchMailboxes });
  const labels = useQuery({ queryKey: ["labels"], queryFn: () => fetchLabels() });
  const threads = useQuery({
    queryKey: ["threads", selectedMailbox, deferredSearch, activeLabel],
    queryFn: () =>
      deferredSearch
        ? searchThreads(deferredSearch, selectedMailbox, activeLabel)
        : fetchThreads(selectedMailbox, activeLabel),
    placeholderData: keepPreviousData,
    enabled: props.view === "inbox",
    refetchInterval: (query) =>
      query.state.data?.some(
        (thread) =>
          thread.draft_run_status === "queued" || thread.draft_run_status === "generating",
      )
        ? 3_000
        : 30_000,
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
      props.settingsSection !== "inboxes" ||
      selectedMailbox !== null ||
      !mailboxes.data?.length
    ) return;
    const defaultMailbox =
      mailboxes.data.find((mailbox) => mailbox.agent_mode !== "off") ?? mailboxes.data[0];
    navigate(`/settings/inboxes/${defaultMailbox.id}`, { replace: true });
  }, [mailboxes.data, navigate, props.settingsSection, props.view, selectedMailbox]);

  const selectMailbox = (id: number | null) => {
    navigate(id === null ? "/inbox" : `/mailboxes/${id}`);
  };

  const openSettings = () => {
    navigate("/settings/general");
  };

  const openInboxSettings = () => {
    const mailboxId =
      selectedMailbox ??
      mailboxes.data?.find((mailbox) => mailbox.agent_mode !== "off")?.id ??
      mailboxes.data?.[0]?.id;
    navigate(mailboxId ? `/settings/inboxes/${mailboxId}` : "/settings/inboxes");
  };

  const updateQuery = (key: "q" | "filter" | "label", value: string, defaultValue = "") => {
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
  const inboxIsEmpty =
    props.view === "inbox" &&
    selectedThread === null &&
    !threads.isLoading &&
    !threads.isError &&
    !threads.isPlaceholderData &&
    deferredSearch === "" &&
    filter === "all" &&
    activeLabel === null &&
    threads.data?.length === 0;

  return (
    <div className="flex h-dvh min-h-[560px] overflow-hidden bg-background text-foreground">
      <Sidebar
        mailboxes={mailboxes.data ?? []}
        selected={selectedMailbox}
        activeView={props.view}
        onSelect={selectMailbox}
        onOpenSettings={openSettings}
      />

      {props.view === "settings" ? (
        <main className="min-w-0 flex-1 overflow-hidden">
          {props.settingsSection === "general" ? (
            <GeneralSettings
              onBack={() => navigate("/inbox")}
              onOpenInboxes={openInboxSettings}
            />
          ) : (
            <AgentSettings
              mailboxes={mailboxes.data ?? []}
              mailboxId={selectedMailbox}
              onSelectMailbox={(id) => navigate(`/settings/inboxes/${id}`)}
              onMailboxDeleted={(nextMailboxId) =>
                navigate(
                  nextMailboxId === null
                    ? "/settings/inboxes"
                    : `/settings/inboxes/${nextMailboxId}`,
                  { replace: true },
                )
              }
              onOpenGeneral={() => navigate("/settings/general")}
              onBack={() => navigate("/inbox")}
            />
          )}
        </main>
      ) : (
        <>
          <ThreadList
            mailboxes={mailboxes.data ?? []}
            threads={threads.data ?? []}
            labels={labels.data ?? []}
            title={selectedMailboxName}
            selected={selectedThread}
            selectedMailbox={selectedMailbox}
            showMailboxChip={selectedMailbox === null}
            search={search}
            filter={filter}
            activeLabel={activeLabel}
            loading={threads.isLoading}
            fetching={threads.isFetching}
            error={threads.isError}
            detailsOpen={selectedThread !== null}
            emptyInbox={inboxIsEmpty}
            onSearch={(query) => updateQuery("q", query)}
            onFilter={(nextFilter) => updateQuery("filter", nextFilter, "all")}
            onSelectLabel={(id) => updateQuery("label", id === null ? "" : String(id))}
            onSelectMailbox={selectMailbox}
            onOpenSettings={openSettings}
            onOpenMailboxSettings={(id) => navigate(`/settings/inboxes/${id}`)}
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
              <EmptyReadingPane empty={inboxIsEmpty} />
            )}
          </main>
        </>
      )}
    </div>
  );
}

function EmptyReadingPane(props: { empty: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-canvas px-6 pb-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full border bg-background text-muted-foreground">
        <InboxIcon className="h-5 w-5" />
      </span>
      <p className="mt-3 text-[13px] font-medium text-foreground">
        {props.empty ? "Nothing here yet" : "No conversation selected"}
      </p>
      <p className="mt-1 max-w-64 text-[12.5px] leading-5 text-muted-foreground">
        {props.empty ? (
          "New email sent to your inboxes will appear in the list."
        ) : (
          <>
            Choose one from the list, or press{" "}
            <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-background px-1 align-[1px] font-sans text-[11px] font-medium">
              /
            </kbd>{" "}
            to search.
          </>
        )}
      </p>
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
