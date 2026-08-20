import type { Mailbox } from "../../shared/types";

export function Sidebar(props: {
  mailboxes: Mailbox[];
  selected: number | null;
  onSelect: (id: number | null) => void;
}) {
  const totalUnread = props.mailboxes.reduce((sum, m) => sum + m.unread_count, 0);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-gray-50">
      <div className="px-4 py-4 text-sm font-semibold tracking-wide text-gray-700">
        Agentic Inbox
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        <SidebarItem
          label="All inboxes"
          color={null}
          unread={totalUnread}
          active={props.selected === null}
          onClick={() => props.onSelect(null)}
        />
        {props.mailboxes.map((m) => (
          <SidebarItem
            key={m.id}
            label={m.display_name ?? m.address}
            color={m.color}
            unread={m.unread_count}
            active={props.selected === m.id}
            onClick={() => props.onSelect(m.id)}
          />
        ))}
      </nav>
    </aside>
  );
}

function SidebarItem(props: {
  label: string;
  color: string | null;
  unread: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={props.onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
        props.active ? "bg-gray-200 font-medium" : "hover:bg-gray-100"
      }`}
    >
      {props.color ? (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: props.color }} />
      ) : (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-gray-400" />
      )}
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.unread > 0 && <span className="text-xs font-semibold text-gray-500">{props.unread}</span>}
    </button>
  );
}
