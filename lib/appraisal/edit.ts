// A2 + A3: decide what an edit really changed, so an unchanged save does
// nothing, a notes-only change keeps the saved value, and a karat, weight or
// category change on a cleared item is treated as a new item to check.

export type EditableAppraisal = {
  category: string; // ring, chain, ...
  category_other: string | null; // description, only used when category is "others"
  karat: number; // 24, 21 or 18
  weight_grams: number; // grams
  condition_notes: string | null; // free text
};

export type AppraisalChange = {
  any: boolean; // at least one field is different
  reprice: boolean; // karat or weight changed, so the value must be recalculated
  material: boolean; // karat, weight or category changed: a cleared flag no longer covers this item
};

const blank = (s: string | null | undefined) => (s ?? "").trim(); // treat null and "" the same

export function compareAppraisal(before: EditableAppraisal, after: EditableAppraisal): AppraisalChange {
  const karat = Number(before.karat) !== Number(after.karat); // the database may return numbers as strings
  const weight = Math.abs(Number(before.weight_grams) - Number(after.weight_grams)) > 0.0005; // weight has 3 decimals
  const category = before.category !== after.category; // e.g. Ring changed to Chain
  const other = blank(before.category_other) !== blank(after.category_other); // the "Others" description
  const notes = blank(before.condition_notes) !== blank(after.condition_notes); // notes only

  return {
    any: karat || weight || category || other || notes, // nothing different means nothing to save
    reprice: karat || weight, // value = weight x price per gram of the karat, so only these two change it
    material: karat || weight || category, // what the item is: these are what the Admin checked
  };
}
