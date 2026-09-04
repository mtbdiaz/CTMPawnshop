alter table public.loan_payments add column verified_via_lost_ticket boolean not null default false;
alter table public.loans add column lost_ticket_used boolean not null default false;
