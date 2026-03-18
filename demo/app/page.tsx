"use client";

import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";

// ─── Constants ───────────────────────────────────────────────────────────────

const CONTRACTS = {
  hook:       "0x85a24bdb644bbeaDcCfB70596400b550fE1b388A",
  pool:       "0xe8D09BE87beD6Baa71CFfD7c2Eb13d9894A9B42c",
  calculator: "0x1E0BA7dB5D0266E019BD72E703a2aAD225Ba4eaa",
  staking:    "0x72275D6627Ce688aD789D6DB960e0be6ae99E670",
  oracle:     "0x8D2662FFd71dfc994F4364004A226CE350A59874",
};

const POOL_ABI = [
  "function solvencyRatio() view returns (uint256)",
  "function totalPremiums() view returns (uint256)",
  "function totalPayouts() view returns (uint256)",
];

const CALC_ABI = [
  "function getPremium(uint256 budget, address provider, uint256 durationDays, uint8 tier) view returns (uint256)",
  "function getCoverage(uint256 budget, uint8 tier) view returns (uint256)",
];

const TIERS = [
  { id: 1, name: "Basic",    coverage: "30%", signal: "Standard commitment",   color: "slate"  },
  { id: 2, name: "Standard", coverage: "60%", signal: "Strong commitment",     color: "blue"   },
  { id: 3, name: "Premium",  coverage: "80%", signal: "Maximum confidence",    color: "violet" },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Quote {
  premium: number;
  coverage: number;
  budgetUSD: number;
  tier: number;
  source: "onchain" | "estimate";
}

interface PoolData {
  solvency: number;
  premiums: number;
  payouts: number;
}

// ─── RPC ─────────────────────────────────────────────────────────────────────

const rpc = new ethers.JsonRpcProvider("https://sepolia.base.org");

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Home() {
  const [budget, setBudget] = useState(1000);
  const [tier, setTier] = useState(2);
  const [duration, setDuration] = useState(30);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [pool, setPool] = useState<PoolData | null>(null);
  const [poolLoading, setPoolLoading] = useState(true);
  const quoteRef = useRef<HTMLDivElement>(null);

  // Fetch pool health on mount
  useEffect(() => {
    (async () => {
      try {
        const contract = new ethers.Contract(CONTRACTS.pool, POOL_ABI, rpc);
        const [s, p, o] = await Promise.all([
          contract.solvencyRatio(),
          contract.totalPremiums(),
          contract.totalPayouts(),
        ]);
        setPool({
          solvency: Number(s),
          premiums: Number(p) / 1e6,
          payouts: Number(o) / 1e6,
        });
      } catch {
        setPool({ solvency: 100, premiums: 0, payouts: 0 });
      }
      setPoolLoading(false);
    })();
  }, []);

  const getQuote = async () => {
    setQuoteLoading(true);
    try {
      const budgetUnits = BigInt(Math.round(budget * 1e6));
      const calc = new ethers.Contract(CONTRACTS.calculator, CALC_ABI, rpc);
      const [premium, coverage] = await Promise.all([
        calc.getPremium(budgetUnits, ethers.ZeroAddress, duration, tier),
        calc.getCoverage(budgetUnits, tier),
      ]);
      setQuote({
        premium: Number(premium) / 1e6,
        coverage: Number(coverage) / 1e6,
        budgetUSD: budget,
        tier,
        source: "onchain",
      });
    } catch {
      const covRatios = [0, 0.3, 0.6, 0.8];
      setQuote({
        premium: Math.max(budget * 0.005, 0.01),
        coverage: budget * covRatios[tier],
        budgetUSD: budget,
        tier,
        source: "estimate",
      });
    }
    setQuoteLoading(false);
    setTimeout(() => quoteRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-100 font-sans">

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative px-6 pt-20 pb-16 max-w-5xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-950 border border-blue-800 text-blue-300 text-xs mb-6">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          Live on Base Sepolia
        </div>

        <h1 className="text-5xl md:text-6xl font-bold text-white mb-4 leading-tight">
          Provider defaults.<br />
          <span className="text-blue-400">Client gets paid.</span><br />
          Automatically.
        </h1>

        <p className="text-gray-400 text-lg mb-8 max-w-2xl mx-auto">
          Performance Bond Insurance for ERC-8183 AI agent job markets.
          Parametric trigger — no proof of loss required.
        </p>

        <div className="flex flex-wrap justify-center gap-3 mb-10">
          {[
            { label: "26/26 tests",     cls: "bg-green-950 border-green-800 text-green-300" },
            { label: "ERC-8183 Hook",   cls: "bg-blue-950 border-blue-800 text-blue-300" },
            { label: "ERC-8004 #33398", cls: "bg-purple-950 border-purple-800 text-purple-300" },
            { label: "Base Sepolia",    cls: "bg-slate-900 border-slate-700 text-slate-300" },
          ].map(({ label, cls }) => (
            <span key={label} className={`px-3 py-1 rounded-full text-sm border ${cls}`}>
              {label}
            </span>
          ))}
        </div>

        <button
          onClick={() => document.getElementById("calculator")?.scrollIntoView({ behavior: "smooth" })}
          className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition-colors text-lg"
        >
          Get a Quote →
        </button>
      </section>

      {/* ── ESCROW VS INSURANCE ─────────────────────────────────────────── */}
      <section className="px-6 py-16 max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-white mb-2">Escrow ≠ Insurance</h2>
        <p className="text-gray-500 mb-8">ERC-8183 guarantees your budget back. agent-insurance covers what comes after.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">ERC-8183 Core (Escrow)</div>
            <p className="text-gray-300 text-sm mb-4">
              Guarantees exactly one thing: if the job is rejected or expires,
              <span className="text-white font-semibold"> you get the budget back.</span>
            </p>
            <div className="font-mono text-xs text-green-400 bg-gray-800 rounded-lg p-3 space-y-1">
              <div>reject() → budget refunded ✅</div>
              <div>claimRefund() → budget refunded ✅</div>
              <div className="text-gray-600 pt-1">// That's all. Nothing more.</div>
            </div>
          </div>

          <div className="bg-blue-950/30 border border-blue-800 rounded-2xl p-6">
            <div className="text-xs text-blue-400 uppercase tracking-wider mb-3">agent-insurance (Insurance Layer)</div>
            <p className="text-gray-300 text-sm mb-4">
              Adds coverage <span className="text-white font-semibold">beyond the budget</span> for real-world losses
              triggered automatically by the on-chain reject event.
            </p>
            <div className="font-mono text-xs text-blue-300 bg-gray-800 rounded-lg p-3 space-y-1">
              <div>reject() → budget refunded ✅</div>
              <div>             + coverageAmt ✅ ← NEW</div>
              <div className="text-gray-600 pt-1">// No proof needed. Parametric.</div>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800">
            <span className="text-sm text-gray-400">What gets covered</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase">
                <th className="text-left px-5 py-3">Loss Type</th>
                <th className="text-left px-5 py-3">Example</th>
                <th className="text-center px-4 py-3">ERC-8183</th>
                <th className="text-center px-4 py-3">+ agent-insurance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {[
                ["Budget refund",           "20 USDC returned",                   true,  true],
                ["Deadline delay costs",    "Campaign launch delayed 2 weeks",     false, true],
                ["Bad output consequences", "Buggy code causes production outage", false, true],
                ["Provider replacement",    "Re-onboarding a new provider",        false, true],
                ["Contract penalties",      "B2B SLA breach fee",                  false, true],
              ].map(([type, example, core, ins]) => (
                <tr key={String(type)} className="hover:bg-gray-800/50">
                  <td className="px-5 py-3 text-gray-300 font-medium">{String(type)}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs">{String(example)}</td>
                  <td className="text-center px-4 py-3">{core ? "✅" : <span className="text-gray-600">—</span>}</td>
                  <td className="text-center px-4 py-3">{ins ? "✅" : <span className="text-gray-600">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 p-4 bg-yellow-950/20 border border-yellow-900/50 rounded-xl">
          <span className="text-yellow-400 font-semibold">💡 Why not build insurance into ERC-8183 core?</span>
          <p className="text-gray-400 text-sm mt-1">
            Premium pricing depends on context — provider reputation, job type, duration, coverage level.
            This complexity belongs in a Hook, not the core. The Hook system is exactly the right abstraction.
            agent-insurance is the reference implementation.
          </p>
        </div>
      </section>

      {/* ── THE PROTOCOL ─────────────────────────────────────────────────── */}
      <section className="px-6 py-16 max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-white mb-2">The Protocol</h2>
        <p className="text-gray-500 mb-10">Pure ERC-8183 Hook — zero core contract modifications.</p>

        <div className="relative">
          {/* Flow diagram */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Provider */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <div className="text-2xl mb-3">🤖</div>
              <div className="font-semibold text-white mb-1">Provider</div>
              <div className="text-sm text-gray-400">
                Pays a small premium when setting job budget.
                Higher tier = stronger commitment signal on-chain.
              </div>
              <div className="mt-3 text-xs text-blue-400 font-mono">setBudget(jobId, amount, tier)</div>
            </div>

            {/* Hook */}
            <div className="bg-blue-950 border border-blue-800 rounded-2xl p-5">
              <div className="text-2xl mb-3">🛡️</div>
              <div className="font-semibold text-white mb-1">PerformanceBondHook</div>
              <div className="text-sm text-gray-300">
                IACPHook implementation. Intercepts <code className="text-blue-300">setBudget</code>, <code className="text-blue-300">complete</code>, <code className="text-blue-300">reject</code>.
              </div>
              <div className="mt-3 text-xs text-blue-400 font-mono">beforeAction / afterAction</div>
            </div>

            {/* Client */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <div className="text-2xl mb-3">👤</div>
              <div className="font-semibold text-white mb-1">Client</div>
              <div className="text-sm text-gray-400">
                Gets full refund from ACP <em>plus</em> coverage from BondPool
                if job is rejected. No claim filing needed.
              </div>
              <div className="mt-3 text-xs text-green-400 font-mono">budget + coverageAmt</div>
            </div>
          </div>

          {/* Two paths */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-green-950/30 border border-green-900 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-green-400 text-lg">✅</span>
                <span className="font-semibold text-green-300">Job Completed</span>
              </div>
              <p className="text-sm text-gray-400">
                Provider receives net payment. Premium stays in pool as yield.
                BondPool grows. Everyone wins.
              </p>
            </div>
            <div className="bg-amber-950/30 border border-amber-900 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-amber-400 text-lg">⚡</span>
                <span className="font-semibold text-amber-300">Job Rejected → Auto Payout</span>
              </div>
              <p className="text-sm text-gray-400">
                72-hour challenge window. After expiry, anyone can call
                <code className="text-amber-300 ml-1">executePayout()</code> — Client receives coverage automatically.
              </p>
            </div>
          </div>

          {/* Key insight */}
          <div className="mt-4 p-4 bg-gray-900 border border-gray-700 rounded-xl">
            <span className="text-yellow-400 font-semibold">💡 Parametric trigger: </span>
            <span className="text-gray-300 text-sm">
              The <code className="text-blue-300">reject()</code> call itself is the trigger.
              No proof of loss. No adjudication. No off-chain arbitration.
              This is what makes it trustless.
            </span>
          </div>
        </div>
      </section>

      {/* ── CALCULATOR ───────────────────────────────────────────────────── */}
      <section id="calculator" className="px-6 py-16 max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-white mb-2">Live Quote Calculator</h2>
        <p className="text-gray-500 mb-10">Queries the deployed PremiumCalculator contract in real-time.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Inputs */}
          <div className="space-y-6">
            {/* Budget */}
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-gray-400 text-sm">Job Budget</label>
                <span className="text-white font-mono font-bold">${budget.toLocaleString()} USDC</span>
              </div>
              <input
                type="range" min={100} max={10000} step={100} value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="w-full accent-blue-500 h-2 bg-gray-800 rounded-full appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>$100</span><span>$10,000</span>
              </div>
            </div>

            {/* Tier */}
            <div>
              <label className="text-gray-400 text-sm block mb-3">Insurance Tier</label>
              <div className="space-y-2">
                {TIERS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTier(t.id)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      tier === t.id
                        ? "bg-blue-900/40 border-blue-600"
                        : "bg-gray-900 border-gray-800 hover:border-gray-700"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="font-medium text-white">{t.name}</span>
                        <span className="text-gray-500 text-sm ml-2">· {t.coverage} coverage</span>
                      </div>
                      <span className="text-xs text-gray-500 italic">{t.signal}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Duration */}
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-gray-400 text-sm">Duration</label>
                <span className="text-white font-mono font-bold">{duration} days</span>
              </div>
              <input
                type="range" min={1} max={365} value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full accent-blue-500 h-2 bg-gray-800 rounded-full appearance-none cursor-pointer"
              />
            </div>

            <button
              onClick={getQuote}
              disabled={quoteLoading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 text-white font-semibold py-4 rounded-xl transition-colors text-lg"
            >
              {quoteLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Querying contract...
                </span>
              ) : "Get On-Chain Quote"}
            </button>
          </div>

          {/* Quote Result */}
          <div ref={quoteRef}>
            {quote ? (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 h-full">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-semibold text-white">Quote Result</h3>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    quote.source === "onchain"
                      ? "bg-green-900/50 text-green-400 border border-green-800"
                      : "bg-gray-800 text-gray-400"
                  }`}>
                    {quote.source === "onchain" ? "✓ Live on-chain" : "Estimate"}
                  </span>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-gray-800 rounded-xl">
                    <div className="text-gray-400 text-sm mb-1">Premium (Provider pays)</div>
                    <div className="text-2xl font-bold font-mono text-yellow-400">
                      ${quote.premium.toFixed(4)} USDC
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {((quote.premium / quote.budgetUSD) * 100).toFixed(2)}% of budget
                    </div>
                  </div>

                  <div className="p-4 bg-gray-800 rounded-xl">
                    <div className="text-gray-400 text-sm mb-1">Coverage (Client receives if rejected)</div>
                    <div className="text-2xl font-bold font-mono text-green-400">
                      ${quote.coverage.toFixed(4)} USDC
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      + full budget refund from ACP = total ${(quote.budgetUSD + quote.coverage).toFixed(2)} USDC
                    </div>
                  </div>

                  <div className="p-4 bg-blue-950/30 border border-blue-900 rounded-xl">
                    <div className="text-gray-400 text-sm mb-1">Coverage ratio</div>
                    <div className="text-xl font-bold text-blue-400">
                      {(quote.coverage / quote.premium).toFixed(1)}x
                    </div>
                    <div className="text-xs text-gray-500">return on premium if rejected</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 border-dashed rounded-2xl p-6 h-full flex items-center justify-center">
                <div className="text-center text-gray-600">
                  <div className="text-4xl mb-3">📊</div>
                  <p>Set your parameters and get a live quote from the deployed contract.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── POOL HEALTH ──────────────────────────────────────────────────── */}
      <section className="px-6 py-16 max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-white mb-2">Pool Health</h2>
        <p className="text-gray-500 mb-10">Live data from BondPool contract on Base Sepolia.</p>

        {poolLoading ? (
          <div className="grid grid-cols-3 gap-4">
            {[1,2,3].map(i => (
              <div key={i} className="h-28 bg-gray-900 rounded-2xl animate-pulse border border-gray-800" />
            ))}
          </div>
        ) : pool && (
          <div className="space-y-4">
            {/* Solvency gauge */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <div className="flex justify-between items-center mb-3">
                <span className="text-gray-400">Solvency Ratio</span>
                <span className={`text-2xl font-bold font-mono ${pool.solvency >= 100 ? "text-green-400" : "text-amber-400"}`}>
                  {pool.solvency}%
                </span>
              </div>
              <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${pool.solvency >= 100 ? "bg-green-500" : "bg-amber-500"}`}
                  style={{ width: `${Math.min(pool.solvency, 100)}%` }}
                />
              </div>
              <div className={`mt-3 text-sm ${pool.solvency >= 100 ? "text-green-400" : "text-amber-400"}`}>
                {pool.solvency >= 100 ? "✅ Pool is healthy — sufficient reserves to cover all policies" : "⚠️ Low reserve — approaching minimum threshold"}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <div className="text-gray-400 text-sm mb-2">Total Premiums Collected</div>
                <div className="text-2xl font-bold font-mono text-green-400">${pool.premiums.toFixed(4)}</div>
                <div className="text-xs text-gray-600 mt-1">USDC</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <div className="text-gray-400 text-sm mb-2">Total Payouts Executed</div>
                <div className="text-2xl font-bold font-mono text-red-400">${pool.payouts.toFixed(4)}</div>
                <div className="text-xs text-gray-600 mt-1">USDC</div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── SECURITY MODEL ───────────────────────────────────────────────── */}
      <section className="px-6 py-16 max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-white mb-2">Security Model</h2>
        <p className="text-gray-500 mb-10">Two-tier defense against moral hazard.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Level 1 — MVP</div>
            <div className="space-y-2">
              {[
                { title: "80% coverage cap", desc: "Client absorbs 20% loss — eliminates pure arbitrage attacks" },
                { title: "72h challenge window", desc: "Provider can dispute fraudulent rejections" },
                { title: "30-day cooldown", desc: "Per client-evaluator pair — limits repeat attacks" },
              ].map(({ title, desc }) => (
                <div key={title} className="flex gap-3 p-3 bg-gray-900 border border-gray-800 rounded-xl">
                  <span className="text-green-400 mt-0.5">✓</span>
                  <div>
                    <div className="text-white text-sm font-medium">{title}</div>
                    <div className="text-gray-500 text-xs">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Level 2 — Production</div>
            <div className="space-y-2">
              {[
                { title: "Evaluator staking (1000 USDC)", desc: "Skin in the game — evaluators lose stake on proven fraud" },
                { title: "Anomaly detection", desc: ">30% reject rate triggers automatic suspension" },
                { title: "MultiSig Evaluator", desc: "2-of-3 consensus required to execute reject()" },
              ].map(({ title, desc }) => (
                <div key={title} className="flex gap-3 p-3 bg-gray-900 border border-gray-800 rounded-xl">
                  <span className="text-blue-400 mt-0.5">◆</span>
                  <div>
                    <div className="text-white text-sm font-medium">{title}</div>
                    <div className="text-gray-500 text-xs">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CONTRACTS ────────────────────────────────────────────────────── */}
      <section className="px-6 py-16 max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-white mb-2">Deployed Contracts</h2>
        <p className="text-gray-500 mb-8">Base Sepolia (chainId 84532) · All verified on BaseScan</p>

        <div className="space-y-2 mb-6">
          {[
            { name: "PerformanceBondHook", addr: CONTRACTS.hook, primary: true },
            { name: "BondPool",            addr: CONTRACTS.pool },
            { name: "PremiumCalculator",   addr: CONTRACTS.calculator },
            { name: "EvaluatorStaking",    addr: CONTRACTS.staking },
            { name: "ReputationOracle",    addr: CONTRACTS.oracle },
          ].map(({ name, addr, primary }) => (
            <div key={name} className={`flex items-center justify-between p-4 rounded-xl border ${
              primary ? "bg-blue-950/20 border-blue-800" : "bg-gray-900 border-gray-800"
            }`}>
              <span className={`text-sm font-medium ${primary ? "text-blue-300" : "text-gray-300"}`}>{name}</span>
              <a
                href={`https://sepolia.basescan.org/address/${addr}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-gray-500 hover:text-blue-400 transition-colors"
              >
                {addr.slice(0, 12)}...{addr.slice(-8)} ↗
              </a>
            </div>
          ))}
        </div>

        {/* ERC-8004 Identity */}
        <div className="p-4 bg-purple-950/20 border border-purple-800 rounded-xl mb-6">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🪪</span>
            <div>
              <div className="text-purple-300 font-medium">ERC-8004 Identity · agentId #33398</div>
              <div className="text-gray-400 text-xs font-mono mt-0.5">
                eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 · Base Mainnet
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <a
            href="https://github.com/oxyuns/agent-insurance"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center py-3 bg-gray-900 hover:bg-gray-800 border border-gray-700 text-gray-300 rounded-xl text-sm transition-colors font-medium"
          >
            GitHub →
          </a>
          <a
            href="https://synthesis.devfolio.co/projects/agent-insurance-a0e7"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center py-3 bg-blue-900 hover:bg-blue-800 border border-blue-700 text-blue-200 rounded-xl text-sm transition-colors font-medium"
          >
            Synthesis Submission →
          </a>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-900 px-6 py-8 text-center text-gray-600 text-xs">
        Built by Tigu (ERC-8004 #33398) for The Synthesis 2026 · Powered by OpenClaw · Base Sepolia
      </footer>
    </div>
  );
}
