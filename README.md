# AVERLOCK Base

The frontend supports **Base Sepolia** for staging and **Base Mainnet** for production through
typed deployment manifests. Base Mainnet reads use official USDC, but AVERLOCK contract reads
and all writes remain unavailable until verified Mainnet deployment values are added.

- Chain ID: `84532`
- RPC: `https://sepolia.base.org`
- Manual/cooldown BaseGuardManager: `0xB2d5B8a9dF91466F07fcBA92f334cb143197151d`
- Manual/cooldown BaseProtectionVault: `0x5f7a95160A34e84B91e25903b69B8B378094a9B0`
- V2 BaseProtectionVault: `0x914Eb41bE452f192e822c82ed83cC2CEAf3c3D23`
- V2 IncomingFundsGuardFactory: `0x355c5ECB31EA54092f56263c591B44f156B325C5`
- Approved Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Manual/indexer start block: `45438094`
- V2 deployment start block: `45527065`

The frontend and indexer remain wired to the manual/cooldown contracts. The V2 addresses are
recorded in the typed staging manifest for future Incoming Funds Guard integration.

Production selects Base Mainnet (chain ID `8453`) and official Base USDC
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. It intentionally defines no GuardManager,
ProtectionVault, factory, incoming guard, or deployment block.

Set `NEXT_PUBLIC_AVERLOCK_ENV=staging|production`; an unset value defaults to staging. RPCs can
be overridden with `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` and `NEXT_PUBLIC_BASE_MAINNET_RPC_URL`.
Deployment addresses are sourced only from `config/deployments` and are not environment overrides.

Contract reads are authoritative for current state. The optional AVERLOCK event indexer handles
only owner discovery and activity/history. It never substitutes indexed or fabricated data for
contract state.

## Local validation

```bash
npm ci
npm run typecheck
npm run lint
npm run test --workspace @averlock/web
npm run test --workspace @averlock/event-indexer
npm run build
npm run check:base-sepolia
```

Copy `apps/web/.env.example` to `apps/web/.env.local` for local web overrides. Copy
`packages/event-indexer/.env.example` to `packages/event-indexer/.env` when running the
indexer locally. These files contain public deployment identifiers only; never add wallet keys,
seed phrases, keystore passwords, or private RPC credentials.

See [docs/base-sepolia.md](docs/base-sepolia.md) for the lifecycle and deployment runbook.
