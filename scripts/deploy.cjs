const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const gasPrice = ethers.parseUnits("1", "gwei");
  const overrides = { gasPrice };

  const POOL_ADDRESS    = "0xe8D09BE87beD6Baa71CFfD7c2Eb13d9894A9B42c";
  const STAKING_ADDRESS = "0x72275D6627Ce688aD789D6DB960e0be6ae99E670";
  const HOOK_ADDRESS    = "0x85a24bdb644bbeaDcCfB70596400b550fE1b388A";

  console.log("Hook:    ", HOOK_ADDRESS);
  console.log("Pool:    ", POOL_ADDRESS);
  console.log("Staking: ", STAKING_ADDRESS);

  // setHook
  const pool = await ethers.getContractAt("BondPool", POOL_ADDRESS);
  const tx1 = await pool.setHook(HOOK_ADDRESS, overrides);
  await tx1.wait();
  console.log("BondPool.setHook ✓");

  // transferOwnership
  const staking = await ethers.getContractAt("EvaluatorStaking", STAKING_ADDRESS);
  const tx2 = await staking.transferOwnership(HOOK_ADDRESS, overrides);
  await tx2.wait();
  console.log("EvaluatorStaking.transferOwnership → hook ✓");

  console.log("\n=== All Done ===");
  console.log(JSON.stringify({
    network: "Base Sepolia (chainId 84532)",
    usdc:       "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    oracle:     "0x8D2662FFd71dfc994F4364004A226CE350A59874",
    calculator: "0x1E0BA7dB5D0266E019BD72E703a2aAD225Ba4eaa",
    pool:       POOL_ADDRESS,
    staking:    STAKING_ADDRESS,
    hook:       HOOK_ADDRESS,
  }, null, 2));
}

main().catch(console.error);
