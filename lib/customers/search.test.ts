import { describe, it, expect } from "vitest";
import { matchRank, rankCustomers } from "./search";

const people = [
  { id: "1", full_name: "Maria Santos", contact_number: "0917-123-4501", id_number: "UMID-0001" },
  { id: "2", full_name: "Mario Reyes", contact_number: "0918 555 0102", id_number: "P1234567" },
  { id: "3", full_name: "Ana Marquez", contact_number: "0920 777 1111", id_number: "DL-998877" },
  { id: "4", full_name: "Jose Dimaranan", contact_number: "0917 000 2222", id_number: "SSS-555" },
];

describe("customer search ranking", () => {
  it("is case-insensitive and ranks full-name prefix matches first", () => {
    expect(rankCustomers(people, "MAR").map((p) => p.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("ranks a word-prefix above a mid-word substring", () => {
    expect(matchRank(people[2], "mar")).toBe(1);
    expect(matchRank(people[3], "mar")).toBe(3);
  });

  it("matches contact numbers ignoring spaces and dashes", () => {
    expect(rankCustomers(people, "0918555").map((p) => p.id)).toEqual(["2"]);
  });

  it("matches ID numbers", () => {
    expect(rankCustomers(people, "dl-9988").map((p) => p.id)).toEqual(["3"]);
    expect(rankCustomers(people, "p123").map((p) => p.id)).toEqual(["2"]);
  });

  it("re-sorts as the query grows", () => {
    expect(rankCustomers(people, "ma")[0].id).toBe("1");
    expect(rankCustomers(people, "mario").map((p) => p.id)).toEqual(["2"]);
  });

  it("returns nothing for an empty query and respects the limit", () => {
    expect(rankCustomers(people, "  ")).toEqual([]);
    expect(rankCustomers(people, "a", 2)).toHaveLength(2);
  });
});
