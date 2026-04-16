-- Add phone snapshot + link to customer_contacts on proposal_recipients.
-- Enables the Recipients UI on proposals to pick from the parent customer's
-- contact list, persist phone per-recipient, and delete recipients without
-- touching customer_contacts.

ALTER TABLE public.proposal_recipients
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.proposal_recipients
  ADD COLUMN IF NOT EXISTS customer_contact_id uuid
    REFERENCES public.customer_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proposal_recipients_customer_contact_id
  ON public.proposal_recipients(customer_contact_id);
