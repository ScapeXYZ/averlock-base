import { describe, expect, it } from "vitest";
import { compactAddress } from "./format";

describe("compactAddress", () => {
  it("returns an em dash when no address is available", () => {
    expect(compactAddress()).toBe("—");
  });

  it("compacts an address using the requested bounds", () => {
    expect(compactAddress("0x1234567890abcdef1234567890abcdef12345678", 8, 6)).toBe(
      "0x123456…345678",
    );
  });
});