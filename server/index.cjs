/**
 * agent-insurance x402 Service
 *
 * Exposes agent-insurance protocol endpoints with x402 payment gating.
 * AI agents pay per-request to query insurance quotes, pool health, and coverage.
 *
 * ERC-8004 identity: agentId=33398, registry=eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 */

const express = require("express");
const { paymentMiddleware, x402ResourceServer } = require("@x402/express");
const { ExactEvmScheme } = require("@x402/evm/exact/server");
const { HTTPFacilitatorClient } = require("@x402/core/server");
const { ethers } = require("ethers");

const app = express();
app.use(express.json());

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4021;
const RECEIVE_ADDRESS = process.env.RECEIVE_ADDRESS || "0x6FFa1e00509d8B625c2F061D7dB07893B37199BC";
const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const NETWORK = "eip155:84532"; // Base Sepolia

// Contract addresses (set after deployment)
const HOOK_ADDRESS = process.env.HOOK_ADDRESS;
const POOL_ADDRESS = process.env.POOL_ADDRESS;
const CALCULATOR_ADDRESS = process.env.CALCULATOR_ADDRESS;

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const POOL_ABI = [
  "function solvencyRatio() view returns (uint256)",
  "function totalPremiums() view returns (uint256)",
  "function totalPayouts() view returns (uint256)",
];

const CALCULATOR_ABI = [
  "function getPremium(uint256 budget, address provider, uint256 durationDays, uint8 tier) view returns (uint256)",
  "function getCoverage(uint256 budget, uint8 tier) view returns (uint256)",
];

// ─── x402 Middleware ──────────────────────────────────────────────────────────
const facilitator = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
const resourceServer = new x402ResourceServer(facilitator)
  .register(NETWORK, new ExactEvmScheme());

app.use(
  paymentMiddleware(
    {
      "GET /quote": {
        accepts: [{
          scheme: "exact",
          price: "$0.001",
          network: NETWORK,
          payTo: RECEIVE_ADDRESS,
        }],
        description: "Get insurance premium quote for a job",
        mimeType: "application/json",
      },
      "GET /pool/health": {
        accepts: [{
          scheme: "exact",
          price: "$0.001",
          network: NETWORK,
          payTo: RECEIVE_ADDRESS,
        }],
        description: "Get BondPool solvency and health metrics",
        mimeType: "application/json",
      },
      "GET /coverage": {
        accepts: [{
          scheme: "exact",
          price: "$0.001",
          network: NETWORK,
          payTo: RECEIVE_ADDRESS,
        }],
        description: "Calculate coverage amount for a given budget and tier",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

// ─── Free Endpoints ───────────────────────────────────────────────────────────

/** Agent identity and service manifest */
app.get("/", (req, res) => {
  res.json({
    name: "agent-insurance",
    description: "Performance Bond Insurance for ERC-8183 job markets",
    version: "1.0.0",
    erc8004: {
      agentId: 33398,
      registry: "eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      operator: "0x6FFa1e00509d8B625c2F061D7dB07893B37199BC",
    },
    contracts: {
      hook: HOOK_ADDRESS || "pending-deployment",
      pool: POOL_ADDRESS || "pending-deployment",
      calculator: CALCULATOR_ADDRESS || "pending-deployment",
      network: "Base Sepolia (eip155:84532)",
    },
    endpoints: [
      { path: "/quote", method: "GET", price: "$0.001", description: "Premium quote" },
      { path: "/pool/health", method: "GET", price: "$0.001", description: "Pool health" },
      { path: "/coverage", method: "GET", price: "$0.001", description: "Coverage calculator" },
      { path: "/agent.json", method: "GET", price: "free", description: "ERC-8004 manifest" },
    ],
  });
});

/** ERC-8004 agent manifest — always free */
app.get("/agent.json", (req, res) => {
  res.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Tigu / agent-insurance",
    description: "Performance Bond Insurance service for ERC-8183 AI agent job markets. Pay per query.",
    version: "1.0.0",
    active: true,
    registrations: [{
      agentId: 33398,
      agentRegistry: "eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    }],
    operator: {
      address: "0x6FFa1e00509d8B625c2F061D7dB07893B37199BC",
      name: "Jay Jo",
      contact: "@Oxyuns",
    },
    supportedTrust: ["reputation"],
    services: [{
      id: "insurance-quote",
      name: "Insurance Quote API",
      description: "Returns premium and coverage for a given budget, provider, duration, and tier",
      endpoint: `http://localhost:${PORT}/quote`,
      payment: { scheme: "x402", price: "$0.001", network: NETWORK },
    }],
  });
});

// ─── Paid Endpoints ───────────────────────────────────────────────────────────

/**
 * GET /quote?budget=1000000&provider=0x...&durationDays=30&tier=2
 * Returns premium and coverage amounts
 */
app.get("/quote", async (req, res) => {
  const { budget, provider, durationDays = 30, tier = 2 } = req.query;

  if (!budget) {
    return res.status(400).json({ error: "budget required (in USDC base units, e.g. 1000000 = 1 USDC)" });
  }

  // If contracts deployed, query on-chain
  if (CALCULATOR_ADDRESS) {
    try {
      const rpc = new ethers.JsonRpcProvider(RPC_URL);
      const calc = new ethers.Contract(CALCULATOR_ADDRESS, CALCULATOR_ABI, rpc);
      const providerAddr = provider || ethers.ZeroAddress;
      const premium = await calc.getPremium(budget, providerAddr, durationDays, tier);
      const coverage = await calc.getCoverage(budget, tier);
      return res.json({
        budget: budget.toString(),
        tier: Number(tier),
        durationDays: Number(durationDays),
        premium: premium.toString(),
        premiumUSDC: (Number(premium) / 1e6).toFixed(6),
        coverage: coverage.toString(),
        coverageUSDC: (Number(coverage) / 1e6).toFixed(6),
        source: "onchain",
      });
    } catch (e) {
      // Fall through to estimate
    }
  }

  // Fallback: off-chain estimate
  const b = BigInt(budget);
  const t = Number(tier);
  const coverageRatios = [0n, 3000n, 6000n, 10000n];
  const covRatio = coverageRatios[t] || 6000n;
  const rawCoverage = b * covRatio / 10000n;
  const coverage = rawCoverage > (b * 8000n / 10000n) ? b * 8000n / 10000n : rawCoverage;
  const premium = b * 50n / 10000n; // min 0.5%

  res.json({
    budget: budget.toString(),
    tier: t,
    durationDays: Number(durationDays),
    premium: premium.toString(),
    premiumUSDC: (Number(premium) / 1e6).toFixed(6),
    coverage: coverage.toString(),
    coverageUSDC: (Number(coverage) / 1e6).toFixed(6),
    source: "estimate",
    note: "Contracts not yet deployed — showing minimum premium estimate",
  });
});

/**
 * GET /pool/health
 * Returns BondPool solvency metrics
 */
app.get("/pool/health", async (req, res) => {
  if (POOL_ADDRESS) {
    try {
      const rpc = new ethers.JsonRpcProvider(RPC_URL);
      const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, rpc);
      const [solvency, premiums, payouts] = await Promise.all([
        pool.solvencyRatio(),
        pool.totalPremiums(),
        pool.totalPayouts(),
      ]);
      return res.json({
        solvencyRatio: Number(solvency),
        totalPremiums: premiums.toString(),
        totalPremiumsUSDC: (Number(premiums) / 1e6).toFixed(2),
        totalPayouts: payouts.toString(),
        totalPayoutsUSDC: (Number(payouts) / 1e6).toFixed(2),
        healthy: Number(solvency) >= 100,
        source: "onchain",
        contract: POOL_ADDRESS,
      });
    } catch (e) {
      return res.status(503).json({ error: "Pool contract query failed", detail: e.message });
    }
  }

  res.json({
    solvencyRatio: 100,
    totalPremiums: "0",
    totalPayouts: "0",
    healthy: true,
    source: "pending-deployment",
    note: "Contracts not yet deployed on Base Sepolia",
  });
});

/**
 * GET /coverage?budget=1000000&tier=2
 * Returns coverage amount for budget + tier
 */
app.get("/coverage", (req, res) => {
  const { budget, tier = 2 } = req.query;
  if (!budget) return res.status(400).json({ error: "budget required" });

  const b = BigInt(budget);
  const t = Number(tier);
  const coverageRatios = [0n, 3000n, 6000n, 10000n];
  const covRatio = coverageRatios[t] || 6000n;
  const rawCoverage = b * covRatio / 10000n;
  const maxCov = b * 8000n / 10000n;
  const coverage = rawCoverage > maxCov ? maxCov : rawCoverage;

  const tierNames = ["None", "Basic (30%)", "Standard (60%)", "Premium (80%)"];
  res.json({
    budget: budget.toString(),
    budgetUSDC: (Number(b) / 1e6).toFixed(2),
    tier: t,
    tierName: tierNames[t] || "Unknown",
    coverage: coverage.toString(),
    coverageUSDC: (Number(coverage) / 1e6).toFixed(2),
    maxCoverageBPS: 8000,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`agent-insurance x402 server running on port ${PORT}`);
  console.log(`ERC-8004 agentId: 33398`);
  console.log(`Receiving payments at: ${RECEIVE_ADDRESS}`);
  console.log(`Network: Base Sepolia (${NETWORK})`);
});
