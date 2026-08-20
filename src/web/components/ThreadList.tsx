import type { ThreadSummary } from "../../shared/types";

export function ThreadList(props: {
  threads: ThreadSummary[];
  selected: number | null;
  showMailboxChip: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <section className="flex w-96 shrink-0 flex-col overflow-y-auto border-r border-gray-200">
      {props.threads.length === 0 && (
        <div className="p-6 text-center text-sm text-gray-400">No conversations</div>
      )}
      {props.threads.map((t) => (
        <button
          key={t.id}
          onClick={() => props.onSelect(t.id)}
          className={`border-b border-gray-100 px-4 py-3 text-left ${
            props.selected === t.id ? "bg-indigo-50" : "hover:bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-2">
            {props.showMailboxChip && (
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: t.mailbox_color }}
                title={t.mailbox_address}
              />
            )}
            <span
              className={`min-w-0 flex-1 truncate text-sm ${t.is_read ? "text-gray-700" : "font-semibold"}`}
            >
              {t.subject || "(no subject)"}
            </span>
            <span className="shrink-0 text-xs text-gray-400">
              {formatTime(t.last_message_at)}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-gray-500">{t.snippet}</div>
        </button>
      ))}
    </section>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
