# AVERLOCK Base contracts

`BaseGuardManager` manages transparent protection guards for an approved ERC-20 asset.
`BaseProtectionVault` holds executed guard funds in immutable, non-cancelable linear-release
positions. Base Sepolia is the staging network; no Base Mainnet addresses are configured yet.

Install dependencies and run checks from this directory:

```bash
forge install OpenZeppelin/openzeppelin-contracts@v5.6.1 --no-git --shallow
forge install foundry-rs/forge-std@v1.11.0 --no-git --shallow
forge fmt --check
forge build
forge test --match-path "test/base/*.t.sol"
```

Deployment uses `script/base/DeployBaseSepolia.s.sol` and requires `BASE_APPROVED_TOKEN` plus a
signer supplied to Foundry at invocation time. The script does not contain or infer addresses.