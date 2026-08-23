# Agentic Inbox

Agentic Inbox is a shared email workspace where people and agents handle customer conversations through the same inboxes.

## Language

**Inbox**:
A manually registered customer-facing email address under one ready Domain, with its own agent configuration and collection of conversations. The address is its sole identity; mail sent to an unregistered address is not part of the workspace.
_Avoid_: Mailbox, account, inbox account

**Domain**:
The shared email namespace inferred from an Inbox address. It becomes ready after inbound routing and outbound sending are configured; one ready Domain can support multiple Inboxes.
_Avoid_: Mailbox domain, sending domain

**All Inboxes**:
The unified view across every registered Inbox.
_Avoid_: Unified inbox, combined inbox

**Base Instructions**:
Inbox-wide product context and behavioral guidance applied to every agent-authored draft for that Inbox.
_Avoid_: System prompt, global prompt

**Playbook**:
Manually authored guidance for one recognizable support scenario, composed with the Inbox's Base Instructions when it matches a conversation.
_Avoid_: Template, canned response, rule

**Agent Draft**:
A proposed reply authored by the agent and held for human review before sending.
_Avoid_: Auto-reply, suggestion

**Draft Run**:
One retryable attempt to produce an Agent Draft for a specific latest inbound Message. A Conversation may have many Draft Runs over time, but only the newest relevant result may become pending.
_Avoid_: Agent job, generation task

**Reply Attempt**:
A durable human-approved intent to send one reply. Retrying the same Reply Attempt must never create another outbound Message.
_Avoid_: Send request, outbox item

**Attachment**:
A file or inline resource carried by one Message and available to people for inspection or download.
_Avoid_: Upload, raw MIME

**Conversation**:
The ordered email exchange grouped under one customer request.
_Avoid_: Ticket, chat
