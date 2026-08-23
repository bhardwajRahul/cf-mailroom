import type { Mailbox } from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InboxIcon, SettingsIcon } from "./Icons";

export function Sidebar(props: {
  mailboxes: Mailbox[];
  selected: number | null;
  activeView: "inbox" | "settings";
  onSelect: (id: number | null) => void;
  onOpenSettings: () => void;
}) {
  const totalUnread = props.mailboxes.reduce((sum, mailbox) => sum + mailbox.unread_count, 0);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-background lg:flex">
      <div className="flex h-14 items-center gap-2 px-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border bg-muted/40 text-foreground">
          <InboxIcon className="h-3.5 w-3.5" />
        </span>
        <p className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground">
          Agentic Inbox
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <SidebarItem
          label="All inboxes"
          icon={<InboxIcon className="h-4 w-4" />}
          unread={totalUnread}
          active={props.activeView === "inbox" && props.selected === null}
          onClick={() => props.onSelect(null)}
        />

        {props.mailboxes.length > 0 && (
          <div className="relative ml-[18px] mt-1 space-y-0.5 border-l pl-2">
            {props.mailboxes.map((mailbox) => (
              <InboxItem
                key={mailbox.id}
                mailbox={mailbox}
                active={props.activeView === "inbox" && props.selected === mailbox.id}
                onClick={() => props.onSelect(mailbox.id)}
              />
            ))}
          </div>
        )}

        <div className="mt-4 border-t pt-2">
          <SidebarItem
            label="Settings"
            icon={<SettingsIcon className="h-4 w-4" />}
            unread={0}
            active={props.activeView === "settings"}
            onClick={props.onOpenSettings}
          />
        </div>
      </nav>
    </aside>
  );
}

function SidebarItem(props: {
  label: string;
  icon: React.ReactNode;
  unread: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={props.active ? "secondary" : "ghost"}
      onClick={props.onClick}
      className="group h-9 w-full justify-start gap-2 overflow-hidden rounded-md px-2 text-left"
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center ${
          props.active ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {props.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-tight font-medium">{props.label}</span>
      </span>
      {props.unread > 0 && (
        <Badge className="h-5 min-w-5 px-1.5 text-[10px] tabular-nums">
          {props.unread > 99 ? "99+" : props.unread}
        </Badge>
      )}
    </Button>
  );
}

function InboxItem(props: {
  mailbox: Mailbox;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={props.active ? "secondary" : "ghost"}
      onClick={props.onClick}
      title={props.mailbox.address}
      className="h-8 w-full justify-start gap-2 overflow-hidden rounded-md px-2 text-left"
    >
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
        {props.mailbox.address}
      </span>
      {props.mailbox.unread_count > 0 && (
        <Badge
          variant="secondary"
          className="h-5 min-w-5 shrink-0 px-1.5 text-[10px] tabular-nums"
        >
          {props.mailbox.unread_count > 99 ? "99+" : props.mailbox.unread_count}
        </Badge>
      )}
    </Button>
  );
}
