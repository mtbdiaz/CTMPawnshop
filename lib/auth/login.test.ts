import { describe, expect, it } from "vitest";
import { friendlyAuthError, validateLogin } from "./login";

describe("friendlyAuthError", () => {
  it("explains a wrong email or password", () => {
    expect(friendlyAuthError("Invalid login credentials")).toBe("That email and password don't match. Check them and try again.");
  });
  it("explains a deactivated account", () => {
    expect(friendlyAuthError("User is banned")).toContain("deactivated");
  });
  it("explains a network problem", () => {
    expect(friendlyAuthError("Failed to fetch")).toContain("Can't reach the server");
  });
  it("keeps the real message when it is not one we know", () => {
    expect(friendlyAuthError("Email not confirmed")).toBe("Email not confirmed");
  });
});

describe("validateLogin", () => {
  it("accepts a normal email and any non-empty password", () => {
    expect(validateLogin("admin@ctmpawnshop.test", "x")).toBeNull();
    expect(validateLogin("  admin@ctmpawnshop.test  ", " spaces are part of a password ")).toBeNull();
  });
  it("asks for each empty field", () => {
    expect(validateLogin("", "")).toEqual({ email: "Enter your email address.", password: "Enter your password." });
    expect(validateLogin("   ", "pw")).toEqual({ email: "Enter your email address." });
  });
  it("catches something that is not an email", () => {
    for (const bad of ["admin", "admin@", "@test", "a b@c.d", "admin@test"]) {
      expect(validateLogin(bad, "pw")?.email).toContain("like name@example.com");
    }
  });
  it("never judges the password beyond empty", () => {
    expect(validateLogin("a@b.co", "1")).toBeNull();
  });
});
