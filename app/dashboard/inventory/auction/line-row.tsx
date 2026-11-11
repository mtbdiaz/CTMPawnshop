import Link from "next/link";
import { Badge } from "@/components/ui";
import { formatDateTime, formatPeso } from "@/lib/format";
import { appraisedText, batchNo, identityMissing, itemRef, itemTitle, lineOutcome, reserveState, type AuctionLine } from "@/lib/inventory/auction";
import { ItemDetails, MarkUnsoldButton, ReserveText, SetReserveButton } from "./auction-parts";
import { RecordSaleButton } from "./record-sale-button";

const BASE = "/dashboard/inventory/auction";

// AP1: one item of an auction batch, as a row. Used by the Queued items tab, the Sales history tab and the batch page,
// so an item looks the same everywhere. What it shows depends on what happened to the item:
//   waiting -> its reserve and the buttons (Set reserve, Record sale, Mark unsold)
//   sold    -> the price, the buyer, who recorded it and when
//   unsold  -> why, who marked it and when
export function LineRow({ line, isAdmin, showBatch = true }: { line: AuctionLine; isAdmin: boolean; showBatch?: boolean }) {
  const title = itemTitle(line);
  const ref = itemRef(line);
  const label = ref ? `${title} · ${ref}` : title;
  const batch = batchNo(line.batch_no);
  const outcome = lineOutcome(line);
  const reserve = reserveState(line.min_price, line.no_reserve);
  const blocked = line.audit_flag === "not_located"; // the database refuses the sale too
  const inLedger = outcome.key === "queued" && line.ledger_sale != null; // 0053: the ledger already has auction money for this ticket

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1 basis-72">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-slate-900">
          {title}
          {ref && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">{ref}</span>}
          <Badge tone={outcome.tone}>{outcome.label}</Badge>
          {outcome.key === "queued" && blocked && <Badge tone="danger">Blocked: not located</Badge>}
          {outcome.key === "queued" && line.audit_flag === "found_elsewhere" && <Badge tone="warning">Check location</Badge>}
          {inLedger && <Badge tone="danger">Ledger already has a sale</Badge>}
        </p>
        <p className="text-xs text-slate-600">
          {line.ticket_number ?? "No loan"} · pawned by {line.customer_name ?? "customer not available"} · {line.vault_location ?? "No location"}
        </p>
        <p className="text-xs text-slate-600">
          {showBatch && (
            <>
              Batch{" "}
              <Link href={`${BASE}/batch/${line.batch_id}`} className="font-medium text-navy-700 underline-offset-2 hover:underline">
                {batch}
              </Link>
              {line.batch_notes ? ` (${line.batch_notes})` : ""} ·{" "}
            </>
          )}
          appraised {appraisedText(line.computed_value)}
        </p>
        {outcome.key === "sold" && (
          <p className="text-xs text-slate-600">
            Sold {formatDateTime(line.sold_at)} to <span className="font-medium text-slate-800">{line.buyer_name ?? "buyer not recorded"}</span> · recorded by{" "}
            {line.sold_by_name ?? "staff"}
            {line.sale_notes && <span className="block break-words italic">&ldquo;{line.sale_notes}&rdquo;</span>}
          </p>
        )}
        {outcome.key === "unsold" && (
          <p className="break-words text-xs text-slate-600">
            Marked not sold {formatDateTime(line.unsold_at)} by {line.unsold_by_name ?? "staff"}: <span className="italic">&ldquo;{line.unsold_reason}&rdquo;</span>. The item went back to
            Forfeited.
          </p>
        )}
        {inLedger && (
          <p className="text-xs text-red-700">
            The cash ledger already has an auction sale of {formatPeso(Number(line.ledger_sale))} for this ticket, but the item is still queued. A sale can&apos;t be recorded
            until an Admin checks the ledger.
          </p>
        )}
        {outcome.key === "queued" && blocked && (
          <p className="text-xs text-red-700">The last physical audit could not find this item. Follow that up on the Physical audit page before selling it.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
        {/* the money column: the sale price for a sold item, otherwise the reserve */}
        <span className="text-right text-xs text-slate-600">
          {outcome.key === "sold" ? "Sold for" : "Reserve"}
          <span className="block text-sm">
            {outcome.key === "sold" ? <span className="font-semibold tabular-nums text-slate-900">{formatPeso(Number(line.sale_price))}</span> : <ReserveText minPrice={line.min_price} noReserve={line.no_reserve} />}
          </span>
          {outcome.key === "sold" && (
            <span className="block">
              reserve: <ReserveLine minPrice={line.min_price} noReserve={line.no_reserve} />
            </span>
          )}
        </span>
        <ItemDetails item={line} />
        {outcome.key === "queued" && (
          <>
            {reserve === "not_set" ? (
              <SetReserveButton lineId={line.id} label={label} value={line.computed_value} />
            ) : (
              isAdmin && <SetReserveButton change lineId={line.id} label={label} value={line.computed_value} />
            )}
            {/* a sale needs the reserve decided first; an item the audit could not find, or one the ledger already has a sale for, can't be sold */}
            {reserve !== "not_set" && !blocked && !inLedger && !identityMissing(line) && (
              <RecordSaleButton
                itemId={line.inventory_item_id}
                label={title}
                refNo={ref}
                ticket={line.ticket_number ?? ""}
                batch={batch}
                auctionDate={line.auction_date}
                minPrice={reserve === "price" ? Number(line.min_price) : null}
                value={line.computed_value}
              />
            )}
            <MarkUnsoldButton itemId={line.inventory_item_id} label={label} batch={batch} />
          </>
        )}
      </div>
    </li>
  );
}

// the reserve in plain small words (inside a sentence, no badge)
function ReserveLine({ minPrice, noReserve }: { minPrice: number | null; noReserve: boolean }) {
  const s = reserveState(minPrice, noReserve);
  return <>{s === "price" ? formatPeso(Number(minPrice)) : s === "no_reserve" ? "none" : "not set"}</>;
}
