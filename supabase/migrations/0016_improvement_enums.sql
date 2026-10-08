-- Improvement pass: enum values must be committed before later migrations use them.
alter type public.loan_status add value if not exists 'reinstated';
alter type public.cash_flow_type add value if not exists 'adjustment';
alter type public.cash_flow_type add value if not exists 'capitalization';

do $$ begin
  create type public.item_category as enum ('earrings','ring','pendant','chain','bracelet','pendant_with_chain','others');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.appraisal_status as enum ('available','pawned');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.extension_type as enum ('renewal','capitalized');
exception when duplicate_object then null; end $$;
