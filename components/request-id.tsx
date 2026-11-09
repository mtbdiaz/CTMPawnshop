"use client"; // runs in the browser: makes a random id once per form

import { useEffect, useState } from "react";

// #31: a one-time id sent with a payment, renewal or capitalize. If the same submit reaches the database twice
// (a network retry, pressing Save again after an error), the database sees the same id and returns the first
// result instead of saving again (migration 0028). The parent changes this input's `key` to get a new id
// for the NEXT real payment or renewal.
export function RequestIdInput() {
  const [id, setId] = useState(""); // empty until the page is ready in the browser (the server makes no id)
  useEffect(() => {
    setId(crypto.randomUUID()); // eslint-disable-line react-hooks/set-state-in-effect -- made once in the browser so the server page and the browser page match
  }, []);
  return <input type="hidden" name="request_id" value={id} />;
}
