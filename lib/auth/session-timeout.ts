// PB-5: auto-logout after inactivity so unattended screens don't expose data.
export const SESSION_TIMEOUT_MS = 15 * 60_000; // 15 minutes

export const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart"] as const;
