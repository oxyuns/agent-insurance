# AGENTS.md — agent-insurance

This file helps agentic judges understand the agent-insurance system.

## What This System Does

agent-insurance is a **parametric performance bond insurance protocol** built as a pure ERC-8183 Hook. It adds an insurance layer on top of ERC-8183 job markets — covering losses beyond the budget refund that ACP core provides.

**One-line summary:** Bad work gets rejected. Client gets paid more. Automatically.

## Agent Identity

- **Agent name:** Tigu
- **ERC-8004 agentId:** 33398
- **Registry:** `eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (Base Mainnet)
- **Operator wallet:** `0x45E8D20A0402D5593e6f57bB27AeF3d5f5383C44`
- **Registration TX:** `0x35b3f7d9b1069405f6e1053a6ff8425b263396b87b51791660336210981e20b2`
- **Agent harness:** OpenClaw
- **Model:** claude-sonnet-4-6

## How to Interact

### Live Demo
**https://agent-insurance-3mg5.vercel.app/**

- Get a live insurance quote: input budget + tier → on-chain query to PremiumCalculator
- View pool health: real-time BondPool solvency from Base Sepolia
- Explore contract addresses with BaseScan links

### Deployed Contracts (Base Sepolia, chainId 84532)

| Contract | Address |
|----------|---------|
| PerformanceBondHook | `0x85a24bdb644bbeaDcCfB70596400b550fE1b388A` |
| BondPool | `0xe8D09BE87beD6Baa71CFfD7c2Eb13d9894A9B42c` |
| PremiumCalculator | `0x1E0BA7dB5D0266E019BD72E703a2aAD225Ba4eaa` |
| EvaluatorStaking | `0x72275D6627Ce688aD789D6DB960e0be6ae99E670` |
| ReputationOracle | `0x8D2662FFd71dfc994F4364004A226CE350A59874` |

### Key Interactions You Can Test

```bash
# 1. Check pool solvency (read-only)
cast call 0xe8D09BE87beD6Baa71CFfD7c2Eb13d9894A9B42c \
  "solvencyRatio()(uint256)" \
  --rpc-url https://sepolia.base.org

# 2. Get premium quote for 1000 USDC job, Standard tier (2), 30 days
cast call 0x1E0BA7dB5D0266E019BD72E703a2aAD225Ba4eaa \
  "getPremium(uint256,address,uint256,uint8)(uint256)" \
  1000000000 0x0000000000000000000000000000000000000000 30 2 \
  --rpc-url https://sepolia.base.org

# 3. Get coverage amount
cast call 0x1E0BA7dB5D0266E019BD72E703a2aAD225Ba4eaa \
  "getCoverage(uint256,uint8)(uint256)" \
  1000000000 2 \
  --rpc-url https://sepolia.base.org
```

## System Architecture

```
AgenticCommerce (ERC-8183 Core)
    │
    │ beforeAction / afterAction (Hook interface)
    ▼
PerformanceBondHook ──── PremiumCalculator ──── ReputationOracle
    │
    │ recordPremium / payout
    ▼
BondPool
    │
    │ recordJob (Level 2)
    ▼
EvaluatorStaking
```

## Core Protocol Flow

1. **Provider** calls `setBudget()` with tier encoded in `optParams`
2. **Hook's `beforeAction`** fires → collects premium from Provider → issues Bond
3. Job executes normally via ERC-8183
4. **If `complete()`** → `afterAction` fires → premium stays as pool yield → `BondReleased`
5. **If `reject()`** → `afterAction` fires → 72h challenge window → `ClaimQueued`
6. After 72h → anyone calls `executePayout()` → Client receives `budget + coverageAmt`

## Key Design Decisions

- **Parametric trigger**: `reject()` call itself is the trigger. No proof of loss required.
- **Pure Hook**: Zero modifications to ERC-8183 core contract.
- **Provider pays premium**: Skin-in-the-game signal of commitment quality.
- **80% coverage cap**: Client absorbs 20% loss — prevents pure arbitrage attacks.
- **claimRefund has no hook**: By ERC-8183 design — prevents hook from blocking emergency refunds.

## Security Model

### Level 1 (Implemented)
- 80% coverage cap (`MAX_COVERAGE_BPS = 8000`)
- 72-hour challenge window
- 30-day cooldown per client-evaluator pair

### Level 2 (Implemented)
- `EvaluatorStaking`: 1000 USDC minimum stake, 10% slash on fraud
- Anomaly detection: >30% reject rate triggers auto-suspension
- `MultiSigEvaluator`: 2-of-3 consensus required to execute `reject()`

## Test Coverage

```
26/26 tests passing

Scenarios covered:
- Normal complete flow (BondReleased)
- Reject + 72h wait + executePayout (ClaimPaid)
- No insurance (tier=None)
- Challenge flow (provider disputes)
- Pool insolvency re-queue
- Access control (NotACP revert)
- EvaluatorStaking: stake, slash, anomaly detection, reinstate
- MultiSigEvaluator: threshold, duplicate confirm, unauthorized
```

## Files of Interest

| File | Description |
|------|-------------|
| `contracts/insurance/PerformanceBondHook.sol` | Core Hook implementation |
| `contracts/insurance/BondPool.sol` | Capital pool |
| `contracts/insurance/PremiumCalculator.sol` | Actuarial pricing |
| `contracts/insurance/EvaluatorStaking.sol` | Level 2 staking |
| `contracts/insurance/MultiSigEvaluator.sol` | Level 2 multisig |
| `agent.json` | ERC-8004 agent manifest |
| `agent_log.json` | Build decisions + milestones |
| `demo/` | Next.js dashboard with live on-chain data |
