import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMailboxes, fetchThreads } from "./api";
import { Sidebar } from "./components/Sidebar";
import { ThreadList } from "./components/ThreadList";
import { ThreadView } from "./components/ThreadView";

export function App() {
  const [selectedMailbox, setSelectedMailbox] = useState<number | null>(null);
  const [selectedThread, setSelectedThread] = useState<number | null>(null);

  const mailboxes = useQuery({ queryKey: ["mailboxes"], queryFn: fetchMailboxes });
  const threads = useQuery({
    queryKey: ["threads", selectedMailbox],
    queryFn: () => fetchThreads(selectedMailbox),
  });

  return (
    <div className="flex h-screen bg-white text-gray-900">
      <Sidebar
        mailboxes={mailboxes.data ?? []}
        selected={selectedMailbox}
        onSelect={(id) => {
          setSelectedMailbox(id);
          setSelectedThread(null);
        }}
      />
      <ThreadList
        threads={threads.data ?? []}
        selected={selectedThread}
        showMailboxChip={selectedMailbox === null}
        onSelect={setSelectedThread}
      />
      <main className="flex-1 overflow-hidden">
        {selectedThread !== null ? (
          <ThreadView threadId={selectedThread} onArchived={() => setSelectedThread(null)} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Select a conversation
          </div>
        )}
      </main>
    </div>
  );
}
