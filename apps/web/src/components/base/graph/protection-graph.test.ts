import { describe, expect, it } from "vitest";
import { protectionGraphNodes } from "./protection-graph";

describe("Protection Graph representation", () => {
  it("contains the complete wallet-to-release topology", () => {
    expect(protectionGraphNodes.map((node) => node.id)).toEqual([
      "wallet", "incoming", "rule", "split", "available", "protected", "vault", "release",
    ]);
  });

  it("marks split values as illustrative node data", () => {
    expect(protectionGraphNodes.find((node) => node.id === "available")?.value).toBe("30%");
    expect(protectionGraphNodes.find((node) => node.id === "protected")?.value).toBe("70%");
  });

  it("provides an explanation for every linear fallback node", () => {
    expect(protectionGraphNodes.every((node) => node.detail.length > 0)).toBe(true);
  });
});
