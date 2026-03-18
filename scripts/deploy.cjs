const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // 1. Payment token (Base Sepolia USDC)
  // Real USDC on Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
  const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  console.log("Using USDC:", USDC_ADDRESS);

  // 2. MockReputationOracle (테스트용 — 실제 배포시 온체인 oracle로 교체)
  const Oracle = await ethers.getContractFactory("MockReputationOracle");
  const oracle = await Oracle.deploy();
  await oracle.waitForDeployment();
  console.log("MockReputationOracle:", await oracle.getAddress());

  // 3. PremiumCalculator
  const Calc = await ethers.getContractFactory("PremiumCalculator");
  const calculator = await Calc.deploy(await oracle.getAddress());
  await calculator.waitForDeployment();
  console.log("PremiumCalculator:", await calculator.getAddress());

  // 4. BondPool (reserveRatio = 2000 = 20%)
  const Pool = await ethers.getContractFactory("BondPool");
  const pool = await Pool.deploy(USDC_ADDRESS, deployer.address, 2000);
  await pool.waitForDeployment();
  console.log("BondPool:", await pool.getAddress());

  // 5. PerformanceBondHook
  // ACP_ADDRESS: ERC-8183 AgenticCommerce on Base Sepolia (필요시 업데이트)
  const ACP_ADDRESS = process.env.ACP_ADDRESS || ethers.ZeroAddress;
  const Hook = await ethers.getContractFactory("PerformanceBondHook");
  const hook = await Hook.deploy(
    ACP_ADDRESS,
    await pool.getAddress(),
    await calculator.getAddress(),
    USDC_ADDRESS
  );
  await hook.waitForDeployment();
  console.log("PerformanceBondHook:", await hook.getAddress());

  // 6. BondPool에 hook 등록
  await pool.setHook(await hook.getAddress());
  console.log("BondPool hook set ✓");

  console.log("\n=== Deployment Summary ===");
  console.log({
    oracle: await oracle.getAddress(),
    calculator: await calculator.getAddress(),
    pool: await pool.getAddress(),
    hook: await hook.getAddress(),
  });

  console.log("\nNext steps:");
  console.log("1. ACP Admin: AgenticCommerce.setHookWhitelist(hook, true)");
  console.log("2. Deposit initial capital: pool.depositCapital(amount)");
  console.log("3. Update ACP_ADDRESS if deploying with real ACP");
}

main().catch(console.error);
