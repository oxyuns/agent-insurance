# agent-insurance Demo — Product Spec
## CEO Review: What We Need to Win

### Critical Missing Elements

1. **No hero moment** — judges open the page and see nothing that stops them. Need a one-liner that immediately conveys the value prop.
2. **No live demo proof** — "26/26 tests" means nothing visually. We need LIVE on-chain data that proves this works.
3. **Flow diagram missing** — ERC-8183 integration isn't visible. Judges need to SEE the hook architecture.
4. **No competitive differentiation** — why is this better than a standard escrow? The "parametric trigger" insight isn't communicated.
5. **Tier selector is flat** — doesn't communicate the skin-in-the-game signal that Providers send.

### Target Audience
Sophisticated crypto builders. They will:
- Scroll fast, scan headers
- Click BaseScan link to verify deployment
- Look for "is this real or a mock?"
- Want to understand the architecture in 30 seconds

### Page Structure (exact)

#### 1. HERO (above fold)
- Tagline: **"Provider defaults. Client gets paid. Automatically."**
- Sub: ERC-8183 Performance Bond Insurance — Base Sepolia
- 3 badges: `Live on-chain` `26/26 tests` `ERC-8004 #33398`
- CTA: "Get a Quote" → scrolls to calculator

#### 2. HOW IT WORKS (visual flow)
- Mermaid-style visual: 3 actors (Provider → Hook → Client)
- Two paths: ✅ Complete = premium stays as yield | ❌ Reject = 72h → auto payout
- Key insight callout: **"Parametric trigger — no proof of loss required"**

#### 3. LIVE QUOTE CALCULATOR
- Budget slider (100 → 10,000 USDC)
- Tier cards (not buttons) — each shows coverage %, premium %, what it signals
- Duration slider
- Result: premium + coverage + "return ratio if rejected"
- Source: LIVE on-chain query via ethers.js

#### 4. POOL HEALTH (live)
- Solvency ratio with animated gauge
- Total premiums / payouts
- Reserve ratio
- "Pool is healthy / low reserve" status

#### 5. ARCHITECTURE (for the technical judges)
- Simple diagram: AgenticCommerce → beforeAction/afterAction → PerformanceBondHook → BondPool
- Code snippet: the key 3 lines of Solidity that make it work
- GitHub link

#### 6. CONTRACTS
- All 5 addresses with BaseScan links
- ERC-8004 identity card

### Design Requirements
- Background: #0a0a0f (near black)
- Accent: #3b82f6 (blue) for primary, #10b981 (green) for success, #f59e0b (amber) for warning
- Font: Inter (clean, technical)
- NO gradients on text — judges hate that
- Borders: subtle gray-800
- Cards: gray-900 with gray-800 border
- Animated elements: only where they add meaning (pool gauge, quote loading)

### Copy That Lands
- "No manual claims. No off-chain arbitration."
- "Provider pays premium → signals confidence"
- "Rejection triggers payout automatically — no proof required"
- "Pure ERC-8183 Hook — zero core contract modifications"
- "72-hour challenge window for dispute resolution"

### Remove
- The "return ratio" label (confusing)
- The 3 feature cards with colored backgrounds (amateur look)
- Generic "How It Works" title — replace with "The Protocol"
