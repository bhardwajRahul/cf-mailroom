import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Label, Mailbox, Playbook } from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  activateDomain,
  createDomain,
  createLabel,
  createMailbox,
  createPlaybook,
  deleteLabel,
  deleteMailbox,
  deletePlaybook,
  fetchDomains,
  fetchLabels,
  fetchPlaybooks,
  updateLabel,
  updateMailbox,
  updatePlaybook,
} from "../api";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon,
  TagIcon,
  TrashIcon,
} from "./Icons";
import { SettingsNavigation } from "./SettingsNavigation";

interface PlaybookEditorState {
  id?: number;
  name: string;
  whenToUse: string;
  instructions: string;
  exampleReply: string;
  enabled: boolean;
}

interface LabelEditorState {
  id?: number;
  name: string;
  condition: string;
}

interface InboxSetupState {
  address: string;
  localPart: string;
  domainName: string;
}

const CLOUDFLARE_EMAIL_ROUTING_URL =
  "https://dash.cloudflare.com/?to=%2F%3Aaccount%2Femail-service%2Frouting";
const CLOUDFLARE_EMAIL_SENDING_URL =
  "https://dash.cloudflare.com/?to=%2F%3Aaccount%2Femail-service%2Fsending";

const EMPTY_PLAYBOOK: PlaybookEditorState = {
  name: "",
  whenToUse: "",
  instructions: "",
  exampleReply: "",
  enabled: true,
};

const EMPTY_LABEL: LabelEditorState = {
  name: "",
  condition: "",
};

export function AgentSettings(props: {
  mailboxes: Mailbox[];
  mailboxId: number | null;
  onSelectMailbox: (id: number) => void;
  onMailboxDeleted: (nextMailboxId: number | null) => void;
  onOpenGeneral: () => void;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [baseInstructions, setBaseInstructions] = useState("");
  const [editor, setEditor] = useState<PlaybookEditorState | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<number | null>(null);
  const [labelEditor, setLabelEditor] = useState<LabelEditorState | null>(null);
  const [labelDeleteConfirmation, setLabelDeleteConfirmation] = useState<number | null>(null);
  const [mailboxEditorOpen, setMailboxEditorOpen] = useState(false);
  const [mailboxAddress, setMailboxAddress] = useState("");
  const [mailboxValidationError, setMailboxValidationError] = useState<string | null>(null);
  const [inboxSetup, setInboxSetup] = useState<InboxSetupState | null>(null);
  const [routingConfirmed, setRoutingConfirmed] = useState(false);
  const [sendingConfirmed, setSendingConfirmed] = useState(false);
  const [deleteInboxOpen, setDeleteInboxOpen] = useState(false);
  const [deleteInboxConfirmation, setDeleteInboxConfirmation] = useState("");

  const selectedMailboxId = props.mailboxId;
  const mailbox = props.mailboxes.find((item) => item.id === selectedMailboxId) ?? null;

  useEffect(() => {
    setBaseInstructions(mailbox?.agent_instructions ?? "");
    setDeleteConfirmation(null);
    setLabelDeleteConfirmation(null);
    setDeleteInboxOpen(false);
    setDeleteInboxConfirmation("");
  }, [mailbox]);

  const playbooks = useQuery({
    queryKey: ["playbooks", selectedMailboxId],
    queryFn: () => fetchPlaybooks(selectedMailboxId!),
    enabled: selectedMailboxId !== null,
  });

  const labels = useQuery({
    queryKey: ["labels", selectedMailboxId],
    queryFn: () => fetchLabels(selectedMailboxId!),
    enabled: selectedMailboxId !== null,
  });

  const domains = useQuery({
    queryKey: ["domains"],
    queryFn: fetchDomains,
  });

  const addMailbox = useMutation({
    mutationFn: (input: { localPart: string; domainId: number }) =>
      createMailbox({ local_part: input.localPart, domain_id: input.domainId }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["mailboxes"] });
      await queryClient.invalidateQueries({ queryKey: ["domains"] });
      setMailboxEditorOpen(false);
      setMailboxAddress("");
      setInboxSetup(null);
      props.onSelectMailbox(created.id);
    },
  });

  const configureAndAddMailbox = useMutation({
    mutationFn: async (setup: InboxSetupState) => {
      let domain = await createDomain({ name: setup.domainName });
      if (domain.status !== "active") domain = await activateDomain(domain.id);
      return createMailbox({ local_part: setup.localPart, domain_id: domain.id });
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["mailboxes"] });
      await queryClient.invalidateQueries({ queryKey: ["domains"] });
      setMailboxEditorOpen(false);
      setMailboxAddress("");
      setInboxSetup(null);
      props.onSelectMailbox(created.id);
    },
  });

  const saveInstructions = useMutation({
    mutationFn: () =>
      updateMailbox(selectedMailboxId!, { agent_instructions: baseInstructions.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mailboxes"] }),
  });

  const toggleDrafting = useMutation({
    mutationFn: (enabled: boolean) =>
      updateMailbox(selectedMailboxId!, { agent_mode: enabled ? "draft" : "off" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mailboxes"] }),
        queryClient.invalidateQueries({ queryKey: ["threads"] }),
      ]);
    },
  });

  const savePlaybook = useMutation({
    mutationFn: async (input: PlaybookEditorState) => {
      const payload = {
        mailbox_id: selectedMailboxId!,
        name: input.name.trim(),
        when_to_use: input.whenToUse.trim(),
        instructions: input.instructions.trim(),
        example_reply: input.exampleReply.trim() || null,
        enabled: input.enabled,
      };
      return input.id ? updatePlaybook(input.id, payload) : createPlaybook(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playbooks", selectedMailboxId] });
      setEditor(null);
    },
  });

  const togglePlaybook = useMutation({
    mutationFn: (playbook: Playbook) =>
      updatePlaybook(playbook.id, { enabled: !playbook.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["playbooks", selectedMailboxId] }),
  });

  const removePlaybook = useMutation({
    mutationFn: (id: number) => deletePlaybook(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playbooks", selectedMailboxId] });
      setDeleteConfirmation(null);
    },
  });

  const saveLabel = useMutation({
    mutationFn: async (input: LabelEditorState) => {
      const payload = {
        mailbox_id: selectedMailboxId!,
        name: input.name.trim(),
        condition: input.condition.trim(),
      };
      return input.id ? updateLabel(input.id, payload) : createLabel(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels"] });
      setLabelEditor(null);
    },
  });

  const removeLabel = useMutation({
    mutationFn: (id: number) => deleteLabel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels"] });
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      setLabelDeleteConfirmation(null);
    },
  });

  const openLabelEditor = (label?: Label) => {
    setLabelEditor(
      label
        ? { id: label.id, name: label.name, condition: label.condition }
        : { ...EMPTY_LABEL },
    );
  };

  const removeMailbox = useMutation({
    mutationFn: (input: { id: number; address: string }) =>
      deleteMailbox(input.id, deleteInboxConfirmation),
    onSuccess: async (_, deleted) => {
      const remainingMailboxes = props.mailboxes.filter((item) => item.id !== deleted.id);
      queryClient.setQueryData<Mailbox[]>(["mailboxes"], remainingMailboxes);
      queryClient.removeQueries({ queryKey: ["playbooks", deleted.id] });
      queryClient.removeQueries({ queryKey: ["threads"] });
      queryClient.removeQueries({ queryKey: ["thread"] });
      setDeleteInboxOpen(false);
      setDeleteInboxConfirmation("");
      props.onMailboxDeleted(remainingMailboxes[0]?.id ?? null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mailboxes"] }),
        queryClient.invalidateQueries({ queryKey: ["domains"] }),
      ]);
    },
  });

  const instructionsDirty =
    baseInstructions.trim() !== (mailbox?.agent_instructions ?? "").trim();

  const openEditor = (playbook?: Playbook) => {
    setEditor(
      playbook
        ? {
            id: playbook.id,
            name: playbook.name,
            whenToUse: playbook.when_to_use,
            instructions: playbook.instructions,
            exampleReply: playbook.example_reply ?? "",
            enabled: Boolean(playbook.enabled),
          }
        : { ...EMPTY_PLAYBOOK },
    );
  };

  const openMailboxEditor = () => {
    addMailbox.reset();
    configureAndAddMailbox.reset();
    setMailboxAddress("");
    setMailboxValidationError(null);
    setInboxSetup(null);
    setRoutingConfirmed(false);
    setSendingConfirmed(false);
    setMailboxEditorOpen(true);
  };

  const prepareInbox = () => {
    const parsed = parseInboxAddress(mailboxAddress);
    if (!parsed) {
      setMailboxValidationError("Enter a valid email address");
      return;
    }
    setMailboxValidationError(null);
    addMailbox.reset();
    configureAndAddMailbox.reset();

    const domain = domains.data?.find((item) => item.name === parsed.domainName);
    if (domain?.status === "active") {
      addMailbox.mutate({ localPart: parsed.localPart, domainId: domain.id });
      return;
    }
    setRoutingConfirmed(false);
    setSendingConfirmed(false);
    setInboxSetup(parsed);
  };

  const setupStepsRemaining = Number(!routingConfirmed) + Number(!sendingConfirmed);

  return (
    <div className="flex h-full min-w-0 flex-col bg-muted/20">
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b bg-background px-4 md:px-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={props.onBack}
          className="-ml-1 lg:hidden"
          aria-label="Back to inbox"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </Button>
        <span className="hidden h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 md:flex">
          <SettingsIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-slate-950">Settings</h1>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full max-w-[920px] px-4 py-6 md:px-6 md:py-8">
          <SettingsNavigation
            active="inboxes"
            onOpenGeneral={props.onOpenGeneral}
            onOpenInboxes={() => undefined}
          />

          <div className="mb-8 border-b pb-6">
            <div className="max-w-sm">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground">Inbox</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={openMailboxEditor}
                  className="-mr-2"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Add inbox
                </Button>
              </div>
              <MailboxSelect
                mailboxes={props.mailboxes}
                selectedMailboxId={selectedMailboxId}
                onSelect={props.onSelectMailbox}
              />
            </div>
          </div>

          <main className="min-w-0 flex-1 space-y-6">
            {mailbox ? (
              <>
                <div className="flex items-start gap-4 rounded-lg border bg-background px-4 py-4 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor="agent-drafting"
                      className="text-sm font-medium text-foreground"
                    >
                      AI drafting
                    </label>
                    <p className="mt-1 max-w-xl text-sm leading-5 text-muted-foreground">
                      Create a draft for new customer messages. Nothing is sent without your approval.
                    </p>
                    {toggleDrafting.isError && (
                      <p className="mt-2 text-xs text-destructive" role="alert">
                        Couldn’t update AI drafting. Try again.
                      </p>
                    )}
                  </div>
                  <Switch
                    id="agent-drafting"
                    checked={
                      toggleDrafting.isPending
                        ? toggleDrafting.variables
                        : mailbox.agent_mode !== "off"
                    }
                    onCheckedChange={(checked) => toggleDrafting.mutate(checked)}
                    disabled={toggleDrafting.isPending}
                    aria-describedby="agent-drafting-description"
                  />
                  <span id="agent-drafting-description" className="sr-only">
                    When enabled, the AI creates drafts that require your review before sending.
                  </span>
                </div>

                <Card className="gap-0 py-0">
                  <CardHeader className="border-b py-4">
                    <CardTitle className="text-sm">Base Instructions</CardTitle>
                    <CardAction>
                    <Button
                      size="sm"
                      onClick={() => saveInstructions.mutate()}
                      disabled={
                        saveInstructions.isPending || !instructionsDirty
                      }
                    >
                      {saveInstructions.isPending
                        ? "Saving…"
                        : saveInstructions.isSuccess && !instructionsDirty
                          ? "Saved"
                          : "Save instructions"}
                    </Button>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="py-4 sm:py-5">
                    <Textarea
                      value={baseInstructions}
                      onChange={(event) => setBaseInstructions(event.target.value)}
                      rows={10}
                      placeholder="Describe the product, the agent's role, voice, general rules, and signature…"
                      className="min-h-64 resize-y bg-background text-sm leading-6"
                    />
                    {saveInstructions.isError && (
                      <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700">
                        Couldn’t save these instructions. Please try again.
                      </p>
                    )}
                  </CardContent>
                </Card>

                <section>
                  <div className="mb-3 flex items-center justify-between gap-4 px-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[14px] font-semibold text-slate-900">Labels</h2>
                      <Badge variant="outline" className="h-5 px-1.5 text-[9.5px] font-normal">
                        {labels.data?.length ?? 0}
                      </Badge>
                    </div>
                    <Button size="sm" onClick={() => openLabelEditor()}>
                      <PlusIcon className="h-4 w-4" />
                      New label
                    </Button>
                  </div>
                  <p className="mb-3 px-1 text-[12px] leading-5 text-muted-foreground">
                    New conversations are automatically tagged with every label whose condition matches. Replies are not labeled.
                  </p>

                  {labels.isLoading && <PlaybookSkeleton />}
                  {labels.isError && (
                    <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-left text-[12px] text-red-700">
                      Couldn’t load labels.
                    </div>
                  )}
                  {labels.data?.length === 0 && (
                    <div className="flex items-center gap-3 rounded-lg border bg-background px-4 py-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <TagIcon className="h-4 w-4" />
                      </span>
                      <p className="text-sm text-muted-foreground">No labels yet</p>
                    </div>
                  )}

                  <div className="space-y-3">
                    {labels.data?.map((label) => (
                      <LabelCard
                        key={label.id}
                        label={label}
                        deleting={removeLabel.isPending && labelDeleteConfirmation === label.id}
                        confirmDelete={labelDeleteConfirmation === label.id}
                        onEdit={() => openLabelEditor(label)}
                        onRequestDelete={() => setLabelDeleteConfirmation(label.id)}
                        onCancelDelete={() => setLabelDeleteConfirmation(null)}
                        onDelete={() => removeLabel.mutate(label.id)}
                      />
                    ))}
                  </div>
                </section>

                <section>
                  <div className="mb-3 flex items-center justify-between gap-4 px-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[14px] font-semibold text-slate-900">Playbooks</h2>
                      <Badge variant="outline" className="h-5 px-1.5 text-[9.5px] font-normal">
                        {playbooks.data?.filter((item) => item.enabled).length ?? 0} active
                      </Badge>
                    </div>
                    <Button size="sm" onClick={() => openEditor()}>
                      <PlusIcon className="h-4 w-4" />
                      New playbook
                    </Button>
                  </div>

                  {playbooks.isLoading && <PlaybookSkeleton />}
                  {playbooks.isError && (
                    <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-left text-[12px] text-red-700">
                      Couldn’t load playbooks.
                    </div>
                  )}
                  {playbooks.data?.length === 0 && (
                    <div className="flex items-center gap-3 rounded-lg border bg-background px-4 py-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <SparklesIcon className="h-4 w-4" />
                      </span>
                      <p className="text-sm text-muted-foreground">No playbooks yet</p>
                    </div>
                  )}

                  <div className="space-y-3">
                    {playbooks.data?.map((playbook) => (
                      <PlaybookCard
                        key={playbook.id}
                        playbook={playbook}
                        toggling={togglePlaybook.isPending}
                        deleting={removePlaybook.isPending && deleteConfirmation === playbook.id}
                        confirmDelete={deleteConfirmation === playbook.id}
                        onToggle={() => togglePlaybook.mutate(playbook)}
                        onEdit={() => openEditor(playbook)}
                        onRequestDelete={() => setDeleteConfirmation(playbook.id)}
                        onCancelDelete={() => setDeleteConfirmation(null)}
                        onDelete={() => removePlaybook.mutate(playbook.id)}
                      />
                    ))}
                  </div>
                </section>

                <section className="flex flex-col gap-3 border-t px-1 pt-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-sm font-medium text-foreground">Delete inbox</h2>
                    <p className="mt-1 break-words text-sm leading-5 text-muted-foreground">
                      Permanently deletes {mailbox.address} and all of its conversations.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    className="self-start sm:self-auto"
                    onClick={() => {
                      removeMailbox.reset();
                      setDeleteInboxConfirmation("");
                      setDeleteInboxOpen(true);
                    }}
                  >
                    Delete inbox
                  </Button>
                </section>
              </>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-left text-sm text-slate-500">
                Add an inbox before configuring the agent.
              </div>
            )}
          </main>
        </div>
      </div>

      {editor && (
        <PlaybookEditor
          state={editor}
          saving={savePlaybook.isPending}
          error={savePlaybook.isError}
          onChange={setEditor}
          onClose={() => setEditor(null)}
          onSave={() => savePlaybook.mutate(editor)}
        />
      )}

      {labelEditor && (
        <LabelEditor
          state={labelEditor}
          saving={saveLabel.isPending}
          error={saveLabel.isError}
          errorMessage={
            saveLabel.error instanceof Error ? saveLabel.error.message : null
          }
          onChange={setLabelEditor}
          onClose={() => setLabelEditor(null)}
          onSave={() => saveLabel.mutate(labelEditor)}
        />
      )}

      <Dialog
        open={mailboxEditorOpen}
        onOpenChange={(open) => {
          setMailboxEditorOpen(open);
          if (!open) {
            addMailbox.reset();
            configureAndAddMailbox.reset();
            setMailboxValidationError(null);
            setInboxSetup(null);
            setRoutingConfirmed(false);
            setSendingConfirmed(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (inboxSetup) {
                if (setupStepsRemaining === 0) configureAndAddMailbox.mutate(inboxSetup);
              }
              else prepareInbox();
            }}
          >
            <DialogHeader>
              <DialogTitle>{inboxSetup ? "Set up inbox" : "Add inbox"}</DialogTitle>
            </DialogHeader>

            {!inboxSetup ? (
              <div className="py-5">
                <Field label="Email address">
                  <Input
                    type="email"
                    value={mailboxAddress}
                    onChange={(event) => {
                      setMailboxAddress(event.target.value);
                      setMailboxValidationError(null);
                      if (addMailbox.isError) addMailbox.reset();
                    }}
                    placeholder="support@example.com"
                    autoComplete="off"
                    autoFocus
                    required
                    aria-invalid={Boolean(mailboxValidationError || addMailbox.isError)}
                  />
                </Field>

                {domains.isError && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                    <p className="text-sm text-destructive">Couldn’t check email setup.</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => domains.refetch()}>
                      Retry
                    </Button>
                  </div>
                )}

                {(mailboxValidationError || addMailbox.isError) && (
                  <p className="mt-3 text-sm text-destructive" role="alert">
                    {mailboxValidationError ??
                      (addMailbox.error instanceof Error
                        ? addMailbox.error.message
                        : "Couldn’t add this inbox")}
                  </p>
                )}
              </div>
            ) : (
              <div className="py-5">
                <div className="flex items-center justify-between gap-3 border-b pb-4">
                  <p className="min-w-0 truncate text-sm font-medium">{inboxSetup.address}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      configureAndAddMailbox.reset();
                      setInboxSetup(null);
                      setRoutingConfirmed(false);
                      setSendingConfirmed(false);
                    }}
                  >
                    Edit
                  </Button>
                </div>

                <fieldset className="divide-y">
                  <legend className="sr-only">Cloudflare setup checklist</legend>
                  <div className="flex items-start gap-3 py-4">
                    <Checkbox
                      id="confirm-email-routing"
                      checked={routingConfirmed}
                      onCheckedChange={(checked) => setRoutingConfirmed(checked === true)}
                      aria-labelledby="email-routing-title"
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <label
                        id="email-routing-title"
                        htmlFor="confirm-email-routing"
                        className="cursor-pointer text-sm font-medium"
                      >
                        Configure incoming mail
                      </label>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        Onboard {inboxSetup.domainName}, then create a rule for {inboxSetup.address}:
                        <span className="block">Send to a Worker → agentic-inbox.</span>
                      </p>
                      <Button asChild type="button" variant="outline" size="sm" className="mt-3">
                        <a
                          href={CLOUDFLARE_EMAIL_ROUTING_URL}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Email Routing
                          <ExternalLinkIcon />
                        </a>
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 py-4">
                    <Checkbox
                      id="confirm-email-sending"
                      checked={sendingConfirmed}
                      onCheckedChange={(checked) => setSendingConfirmed(checked === true)}
                      aria-labelledby="email-sending-title"
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <label
                        id="email-sending-title"
                        htmlFor="confirm-email-sending"
                        className="cursor-pointer text-sm font-medium"
                      >
                        Configure outbound sending
                      </label>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        Onboard {inboxSetup.domainName} in Email Sending and wait for it to become active.
                      </p>
                      <Button asChild type="button" variant="outline" size="sm" className="mt-3">
                        <a
                          href={CLOUDFLARE_EMAIL_SENDING_URL}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Email Sending
                          <ExternalLinkIcon />
                        </a>
                      </Button>
                    </div>
                  </div>
                </fieldset>

                {configureAndAddMailbox.isError && (
                  <p className="text-sm text-destructive" role="alert">
                    {configureAndAddMailbox.error instanceof Error
                      ? configureAndAddMailbox.error.message
                      : "Couldn’t add this inbox"}
                  </p>
                )}
              </div>
            )}

            <DialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {inboxSetup && (
                <p className="mr-auto text-xs text-muted-foreground" aria-live="polite">
                  {2 - setupStepsRemaining} of 2 complete
                </p>
              )}
              <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMailboxEditorOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    domains.isLoading ||
                    domains.isError ||
                    (!inboxSetup && !mailboxAddress.trim()) ||
                    (inboxSetup !== null && setupStepsRemaining > 0) ||
                    addMailbox.isPending ||
                    configureAndAddMailbox.isPending
                  }
                >
                  {addMailbox.isPending || configureAndAddMailbox.isPending
                    ? "Adding…"
                    : "Add inbox"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteInboxOpen}
        onOpenChange={(open) => {
          if (removeMailbox.isPending) return;
          setDeleteInboxOpen(open);
          if (!open) {
            setDeleteInboxConfirmation("");
            removeMailbox.reset();
          }
        }}
      >
        <DialogContent showCloseButton={!removeMailbox.isPending} className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                mailbox &&
                deleteInboxConfirmation === mailbox.address &&
                !removeMailbox.isPending
              ) {
                removeMailbox.mutate({ id: mailbox.id, address: mailbox.address });
              }
            }}
          >
            <DialogHeader>
              <DialogTitle className="break-words">Delete {mailbox?.address}?</DialogTitle>
              <DialogDescription>
                This permanently deletes its conversations, drafts, and playbooks. This can’t be undone.
              </DialogDescription>
            </DialogHeader>

            {mailbox && (
              <Field label={`Type ${mailbox.address} to confirm`}>
                <Input
                  value={deleteInboxConfirmation}
                  onChange={(event) => {
                    setDeleteInboxConfirmation(event.target.value);
                    if (removeMailbox.isError) removeMailbox.reset();
                  }}
                  autoComplete="off"
                  autoFocus
                  disabled={removeMailbox.isPending}
                  aria-invalid={removeMailbox.isError}
                />
              </Field>
            )}

            {removeMailbox.isError && (
              <p className="text-sm text-destructive" role="alert">
                {removeMailbox.error instanceof Error
                  ? removeMailbox.error.message
                  : "Couldn’t delete this inbox"}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteInboxOpen(false)}
                disabled={removeMailbox.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={
                  !mailbox ||
                  deleteInboxConfirmation !== mailbox.address ||
                  removeMailbox.isPending
                }
              >
                {removeMailbox.isPending ? "Deleting…" : "Delete inbox"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function parseInboxAddress(value: string): InboxSetupState | null {
  const address = value.trim().toLowerCase();
  const separator = address.lastIndexOf("@");
  if (separator <= 0 || separator === address.length - 1) return null;

  const localPart = address.slice(0, separator);
  const domainName = address.slice(separator + 1);
  const validLocalPart =
    localPart.length <= 64 &&
    !localPart.startsWith(".") &&
    !localPart.endsWith(".") &&
    !localPart.includes("..") &&
    /^[a-z0-9._+-]+$/.test(localPart);
  const validDomain =
    domainName.length <= 253 &&
    domainName.includes(".") &&
    domainName.split(".").every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    );

  return validLocalPart && validDomain ? { address, localPart, domainName } : null;
}

function PlaybookCard(props: {
  playbook: Playbook;
  toggling: boolean;
  deleting: boolean;
  confirmDelete: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className={`p-4 sm:p-5 ${props.playbook.enabled ? "" : "opacity-65"}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600">
          <SparklesIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold text-slate-900">{props.playbook.name}</h3>
            {!props.playbook.enabled && (
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
                Disabled
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-slate-500">
            {props.playbook.when_to_use}
          </p>
        </div>
        <Switch
          aria-label={`${props.playbook.enabled ? "Disable" : "Enable"} ${props.playbook.name}`}
          onCheckedChange={props.onToggle}
          checked={Boolean(props.playbook.enabled)}
          disabled={props.toggling}
        />
      </div>

      <div className="mt-4 border-t pt-3">
        <p className="text-[9px] font-semibold tracking-wide text-slate-400 uppercase">How to reply</p>
        <p className="mt-1 line-clamp-3 text-[11.5px] leading-relaxed text-slate-600">
          {props.playbook.instructions}
        </p>
      </div>

      <div className="mt-3 flex items-center justify-end gap-3">
        {props.confirmDelete ? (
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-[10px] text-red-600">Delete this playbook?</span>
            <Button
              variant="ghost"
              size="xs"
              onClick={props.onCancelDelete}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="xs"
              onClick={props.onDelete}
              disabled={props.deleting}
            >
              {props.deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={props.onEdit}
            >
              <PencilIcon className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={props.onRequestDelete}
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Delete ${props.playbook.name}`}
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function MailboxSelect(props: {
  mailboxes: Mailbox[];
  selectedMailboxId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <Select
      value={props.selectedMailboxId === null ? undefined : String(props.selectedMailboxId)}
      onValueChange={(value) => props.onSelect(Number(value))}
    >
      <SelectTrigger className="h-10 w-full text-sm" aria-label="Inbox">
        <SelectValue placeholder="Choose inbox" />
      </SelectTrigger>
      <SelectContent>
        {props.mailboxes.map((item) => (
          <SelectItem key={item.id} value={String(item.id)}>
            {item.address}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PlaybookEditor(props: {
  state: PlaybookEditorState;
  saving: boolean;
  error: boolean;
  onChange: (state: PlaybookEditorState) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const valid =
    props.state.name.trim() &&
    props.state.whenToUse.trim() &&
    props.state.instructions.trim();

  const update = (fields: Partial<PlaybookEditorState>) =>
    props.onChange({ ...props.state, ...fields });

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.state.id ? "Edit playbook" : "New playbook"}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <Field label="Name">
            <Input
              value={props.state.name}
              onChange={(event) => update({ name: event.target.value })}
              placeholder="Refund requests"
              autoFocus
            />
          </Field>

          <Field label="When to use">
            <Textarea
              value={props.state.whenToUse}
              onChange={(event) => update({ whenToUse: event.target.value })}
              placeholder="Use when a customer asks to cancel a charge, reverse a payment, or receive a refund."
              rows={3}
            />
          </Field>

          <Field label="How to reply">
            <Textarea
              value={props.state.instructions}
              onChange={(event) => update({ instructions: event.target.value })}
              placeholder="Acknowledge the request. Verify the payment before promising a refund. Do not promise an exact arrival date."
              rows={5}
            />
          </Field>

          <Field label="Example reply (optional)">
            <Textarea
              value={props.state.exampleReply}
              onChange={(event) => update({ exampleReply: event.target.value })}
              placeholder="Thanks for reaching out…"
              rows={5}
            />
          </Field>

          <label className="flex cursor-pointer items-center justify-between rounded-lg border bg-muted/40 px-3.5 py-3">
            <span className="text-[12px] font-medium text-slate-700">Enabled</span>
            <Switch
              checked={props.state.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
            />
          </label>

          {props.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700">
              Couldn’t save this playbook. Check the fields and try again.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={props.onClose}
          >
            Cancel
          </Button>
          <Button
            onClick={props.onSave}
            disabled={!valid || props.saving}
          >
            {props.saving ? "Saving…" : props.state.id ? "Save changes" : "Create playbook"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-slate-700">{props.label}</span>
      <span className="mt-1.5 block">{props.children}</span>
    </label>
  );
}

function LabelCard(props: {
  label: Label;
  deleting: boolean;
  confirmDelete: boolean;
  onEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600">
          <TagIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold text-slate-900">{props.label.name}</h3>
          </div>
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-slate-500">
            {props.label.condition}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-3">
        {props.confirmDelete ? (
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-[10px] text-red-600">Delete this label?</span>
            <Button
              variant="ghost"
              size="xs"
              onClick={props.onCancelDelete}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="xs"
              onClick={props.onDelete}
              disabled={props.deleting}
            >
              {props.deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={props.onEdit}
            >
              <PencilIcon className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={props.onRequestDelete}
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Delete ${props.label.name}`}
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function LabelEditor(props: {
  state: LabelEditorState;
  saving: boolean;
  error: boolean;
  errorMessage: string | null;
  onChange: (state: LabelEditorState) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const valid = props.state.name.trim() && props.state.condition.trim();

  const update = (fields: Partial<LabelEditorState>) =>
    props.onChange({ ...props.state, ...fields });

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{props.state.id ? "Edit label" : "New label"}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <Field label="Name">
            <Input
              value={props.state.name}
              onChange={(event) => update({ name: event.target.value })}
              placeholder="guest-post"
              autoFocus
            />
          </Field>

          <Field label="Match condition">
            <Textarea
              value={props.state.condition}
              onChange={(event) => update({ condition: event.target.value })}
              placeholder="Apply when the sender pitches writing a guest article for our blog, or asks us to publish their contributed post."
              rows={4}
            />
            <span className="mt-1.5 block text-[11px] leading-4 text-muted-foreground">
              New incoming emails are checked against this description. Replies in existing conversations are not labeled.
            </span>
          </Field>

          {props.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700">
              {props.errorMessage ?? "Couldn’t save this label. Check the fields and try again."}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={props.onClose}
          >
            Cancel
          </Button>
          <Button
            onClick={props.onSave}
            disabled={!valid || props.saving}
          >
            {props.saving ? "Saving…" : props.state.id ? "Save changes" : "Create label"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlaybookSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1].map((item) => (
        <div key={item} className="animate-pulse rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <span className="h-9 w-9 rounded-xl bg-slate-100" />
            <div className="flex-1 space-y-2">
              <span className="block h-3 w-1/4 rounded bg-slate-100" />
              <span className="block h-2.5 w-3/4 rounded bg-slate-100" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
