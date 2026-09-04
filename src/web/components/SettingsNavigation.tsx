import { Button } from "@/components/ui/button";

export type SettingsSection = "general" | "inboxes";

export function SettingsNavigation(props: {
  active: SettingsSection;
  onOpenGeneral: () => void;
  onOpenInboxes: () => void;
}) {
  return (
    <nav aria-label="Settings sections" className="mb-7 flex gap-1 border-b pb-3">
      <Button
        variant={props.active === "general" ? "secondary" : "ghost"}
        size="sm"
        onClick={props.onOpenGeneral}
        aria-current={props.active === "general" ? "page" : undefined}
      >
        General
      </Button>
      <Button
        variant={props.active === "inboxes" ? "secondary" : "ghost"}
        size="sm"
        onClick={props.onOpenInboxes}
        aria-current={props.active === "inboxes" ? "page" : undefined}
      >
        Inboxes
      </Button>
    </nav>
  );
}
