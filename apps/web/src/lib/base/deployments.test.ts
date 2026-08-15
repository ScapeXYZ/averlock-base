import { describe, expect, it } from "vitest";
import { AVERLOCK_BUILDER_CODE, AVERLOCK_DATA_SUFFIX } from "./config";
import {
  deployments,
  getDeployment,
  hasDeployedContracts,
  resolveDeploymentEnvironment,
} from "./deployments";

describe("Base deployment configuration", () => {
  it("defaults local development to Base Sepolia staging", () => {
    expect(resolveDeploymentEnvironment(undefined)).toBe("staging");
    expect(getDeployment("staging").chainId).toBe(84532);
  });

  it("resolves production only to Base Mainnet", () => {
    expect(resolveDeploymentEnvironment("production")).toBe("production");
    expect(getDeployment("production").chainId).toBe(8453);
  });

  it("retains the working staging deployment", () => {
    expect(deployments.staging).toMatchObject({
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      contracts: {
        guardManager: "0xB2d5B8a9dF91466F07fcBA92f334cb143197151d",
        protectionVault: "0x5f7a95160A34e84B91e25903b69B8B378094a9B0",
      },
      deploymentBlock: 45438094,
      writesEnabled: true,
    });
    expect(hasDeployedContracts(deployments.staging)).toBe(true);
  });

  it("leaves Mainnet AVERLOCK contracts absent and writes disabled", () => {
    expect(deployments.production.usdc).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(deployments.production.contracts).toEqual({});
    expect(deployments.production.deploymentBlock).toBeNull();
    expect(deployments.production.writesEnabled).toBe(false);
    expect(hasDeployedContracts(deployments.production)).toBe(false);
  });

  it("keeps ERC-8021 Builder Code attribution configured", () => {
    expect(AVERLOCK_BUILDER_CODE).toBe("bc_wxycqary");
    expect(AVERLOCK_DATA_SUFFIX).toMatch(/^0x/);
  });
});
