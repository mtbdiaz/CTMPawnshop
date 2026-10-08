import { Badge, type BadgeTone } from "./ui";
import type { Tier } from "@/lib/customers/score";

const TIER_TONE: Record<Tier, BadgeTone> = { Excellent: "success", Good: "info", Fair: "warning", Risky: "danger" };

/** Item 6: 0-100 customer score with its tier, or "No history". */
export function ScoreBadge({ score, tier }: { score: number | null; tier: Tier | null }) {
  if (score === null || !tier) return <Badge tone="neutral">No history</Badge>;
  return (
    <Badge tone={TIER_TONE[tier]}>
      {score} {tier}
    </Badge>
  );
}
