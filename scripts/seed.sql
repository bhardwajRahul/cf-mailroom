-- Local development seed data. Run: npm run db:seed:local
INSERT INTO mailboxes (address, display_name, color, agent_mode) VALUES
  ('support@yourdomain.com', 'Product A Support', '#6366f1', 'draft'),
  ('help@otherdomain.com', 'Product B Support', '#10b981', 'off');

INSERT INTO threads (mailbox_id, subject, normalized_subject, snippet, is_read, message_count, last_message_at) VALUES
  (1, 'Refund request for order #1234', 'refund request for order #1234', 'Hi, I was charged twice for my subscription last week...', 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (2, 'Cannot log in to my account', 'cannot log in to my account', 'I keep getting an invalid password error even after reset...', 1, 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'));

INSERT INTO messages (thread_id, message_id, direction, sent_by, from_address, from_name, to_addresses, subject, text_body) VALUES
  (1, '<seed-msg-1@example.com>', 'inbound', 'external', 'customer@example.com', 'Alice Customer', '["support@yourdomain.com"]', 'Refund request for order #1234', 'Hi, I was charged twice for my subscription last week. Could you check order #1234 and refund the duplicate charge? Thanks!'),
  (2, '<seed-msg-2@example.com>', 'inbound', 'external', 'bob@example.com', 'Bob User', '["help@otherdomain.com"]', 'Cannot log in to my account', 'I keep getting an invalid password error even after reset. My account email is bob@example.com.'),
  (2, '<seed-msg-3@example.com>', 'outbound', 'human', 'help@otherdomain.com', 'Product B Support', '["bob@example.com"]', 'Re: Cannot log in to my account', 'Hi Bob, sorry about that. Could you tell me roughly when you last logged in successfully?');

INSERT INTO drafts (thread_id, text_body, created_by, agent_notes, status) VALUES
  (1, 'Hi Alice,\n\nThanks for reaching out. I checked order #1234 and confirmed a duplicate charge on your subscription. I''ve issued a refund for the second charge — it should appear on your statement within 5-7 business days.\n\nBest,\nProduct A Support', 'agent', 'Looked up order #1234 in Stripe: two identical charges 3 minutes apart on the same card. Classic double-submit. Refunded the newer one.', 'pending');
