# CTM PawnTrack: Design Notes (de-vibe-coding audit)

## What reads as "AI-generated / vibe coded" (research, Oct 2026)

Sources:
- [How to avoid that vibe coded look](https://robotsonpayroll.substack.com/p/how-to-avoid-that-vibe-coded-look)
- [7 Signs a UI Has Been Vibe Coded](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui) and [7 Tells that a UI is AI-Generated](https://pages.thefountaininstitute.com/posts/7-tells-that-a-ui-is-ai-generated)
- [AI design slop: overused UI patterns (2026)](https://noqta.tn/en/blog/ai-design-slop-overused-ui-patterns-fix-2026)
- [The visible tells of AI design (impeccable.style)](https://www.impeccable.style/slop)
- [AI's UI slop is taking over the web](https://zeli.app/story/49867038)
- [You don't have to make AI slop](https://matthewblode.com/blog/you-dont-have-to-make-ai-slop)
- [I Can Tell AI Built Your Dashboard (Tableau user group)](https://usergroups.tableau.com/events/details/tableau-st-louis-tableau-user-group-presents-i-can-tell-ai-built-your-dashboard-and-thats-a-problem/)
- [AI dashboard design (Eleken)](https://www.eleken.co/blog-posts/ai-dashboard-design)
- [How to design a dashboard with Claude Code (ux-skill wiki)](https://github.com/Laith0003/ux-skill/wiki/How-to-design-a-dashboard-with-Claude-Code)

Most of these are design blogs and vendor posts, so they are opinion, not measured research. The recurring tells:

1. **Purple / blue-violet gradients** as the default accent (Tailwind's palette skews this way).
2. **Glow, glassmorphism, blur, aurora backgrounds**, a hairline border plus a wide soft shadow on every card.
3. **One exaggerated radius on everything** (cards, inputs, buttons, badges), so hierarchy flattens.
4. **Gradient text** on headings and metrics; **gradients on status pills** read as marketing, not data.
5. **Emoji or icon-in-a-coloured-circle** decoration on every section and empty state.
6. **The equal KPI grid**: three or four identical cards with a big number, often with fake trend arrows and percentage deltas. Operators never read KPIs equally.
7. **Every metric wrapped in its own card**, generous uniform padding, no density.
8. **Default typography with no decision** (Inter everywhere), proportional numerals in tables so columns do not align.
9. **Only the happy path**: no real empty, loading or error states, or cheerful/joke empty states.
10. **Generic copy**: greetings ("Welcome back", "Good morning"), marketing filler ("seamless", "powerful", "done right"), placeholder text. From editing practice (no source found specifically): em dashes and exclamation marks scattered through UI labels.

## Audit of this app (before the fix)

| Tell | Found in CTM PawnTrack | Action |
|---|---|---|
| Purple gradients | None. Brand is navy + gold from the original prototype. | Kept. |
| Gradients / glow | Gradient gold logo tiles (sidebar, login); blurred gold glow on the login panel. | Flat navy mark; glow removed. |
| Heavy radius + shadow | `rounded-xl` + `shadow-sm` on every card, stat tile, panel. | 6px radius (`rounded-md`), flat 1px borders, no shadows except dialogs. |
| Gradient text / pills | None. Monthly-volume bars used a navy gradient. | Solid bars. |
| Icon-in-circle decoration | Every empty state had an icon in a tinted circle; report index used icon tiles. | Plain text empty states; plain report list. |
| Equal KPI grid | Dashboard: four equal coloured stat cards; Finance and Analytics the same. | Dashboard leads with the work queue (overdue / due soon); figures are one compact summary row. No trend arrows existed, none added. |
| Uniform padding | Table cells 12px vertical. | Compact rows (8px) for counter work. |
| Typography | Deliberate: Playfair Display titles, DM Sans UI, DM Mono ticket numbers, tabular numerals. | Kept (brand from the prototype). Money right-aligned everywhere. |
| Happy path only | Loading, error, not-found and empty states exist (Pass 3). Empty states were friendly but generic. | Plain functional wording ("No loans match this filter."). |
| Greeting / filler copy | "Good morning, Test", "Signed in as Admin", login "Gold pawn management, done right." | Removed (item 14). Login states what the system is for staff. |
| Em dashes | Used throughout UI copy and option labels. | Replaced in UI strings with commas, colons or separate sentences. |

## House rules going forward

- One accent (navy) for actions; gold only for the brand mark and the active nav marker. Red and amber only for status.
- 6px radius, 1px slate borders, no decorative shadows.
- Numbers: tabular figures, right-aligned, always `₱1,234.50`; dates `en-PH`, Manila time.
- Status is a text badge (Active, Renewed, Reinstated, Overdue, Defaulted), never colour alone.
- Labels say what the thing is ("Record payment", "View ticket"). No greetings, no exclamation marks, no em dashes in UI copy.
- Empty states state the fact and, if useful, the next action. No jokes.
