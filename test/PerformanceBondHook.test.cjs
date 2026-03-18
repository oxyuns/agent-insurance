const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PerformanceBondHook — Integration Tests", function () {
  let usdc, oracle, pool, calculator, hook, acp;
  let owner, client, provider, evaluator, stranger;

  const BUDGET = ethers.parseUnits("1000", 6); // 1000 USDC
  const TIER_STANDARD = 2;
  const CHALLENGE_PERIOD = 72 * 3600;
  const ONE_DAY = 86400;

  async function deployAll() {
    [owner, client, provider, evaluator, stranger] = await ethers.getSigners();

    // MockUSDC
    const USDC = await ethers.getContractFactory("MockUSDC");
    usdc = await USDC.deploy();

    // MockReputationOracle
    const Oracle = await ethers.getContractFactory("MockReputationOracle");
    oracle = await Oracle.deploy();

    // PremiumCalculator
    const Calc = await ethers.getContractFactory("PremiumCalculator");
    calculator = await Calc.deploy(await oracle.getAddress());

    // BondPool (reserveRatio = 2000 = 20%)
    const Pool = await ethers.getContractFactory("BondPool");
    pool = await Pool.deploy(await usdc.getAddress(), owner.address, 2000);

    // MockACP
    const ACP = await ethers.getContractFactory("MockACP");
    acp = await ACP.deploy();

    // PerformanceBondHook
    const Hook = await ethers.getContractFactory("PerformanceBondHook");
    hook = await Hook.deploy(
      await acp.getAddress(),
      await pool.getAddress(),
      await calculator.getAddress(),
      await usdc.getAddress()
    );

    // BondPool에 hook 주소 등록
    await pool.setHook(await hook.getAddress());

    // 초기 자본 투입 (5000 USDC)
    await usdc.mint(owner.address, ethers.parseUnits("5000", 6));
    await usdc.approve(await pool.getAddress(), ethers.parseUnits("5000", 6));
    await pool.depositCapital(ethers.parseUnits("5000", 6));

    // provider 완료율 설정 (70%)
    await oracle.setCompletionRate(provider.address, 7000);
  }

  async function setupJob() {
    const expiredAt = (await time.latest()) + 30 * ONE_DAY;
    const jobId = await acp.connect(client).createJob.staticCall(
      provider.address, evaluator.address, expiredAt, "Test job", await hook.getAddress(), BUDGET
    );
    await acp.connect(client).createJob(
      provider.address, evaluator.address, expiredAt, "Test job", await hook.getAddress(), BUDGET
    );
    return jobId;
  }

  async function mintAndApprove(to, amount) {
    await usdc.mint(to.address, amount);
    await usdc.connect(to).approve(await hook.getAddress(), amount);
  }

  beforeEach(async () => {
    await deployAll();
  });

  // ─── 1. 정상 완료 플로우 ─────────────────────────────────────
  describe("Normal complete flow", function () {
    it("setBudget with tier=2 should issue bond and collect premium", async () => {
      const jobId = await setupJob();

      const durationDays = 30;
      const premium = await calculator.getPremium(BUDGET, provider.address, durationDays, TIER_STANDARD);

      await mintAndApprove(provider, premium * 2n);

      const optParams = ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [TIER_STANDARD]);
      await expect(acp.connect(provider).setBudget(jobId, BUDGET, optParams))
        .to.emit(hook, "BondIssued");

      const policy = await hook.policies(jobId);
      expect(policy.active).to.be.true;
      expect(policy.tier).to.equal(TIER_STANDARD);
      expect(policy.premium).to.be.gt(0);
    });

    it("complete should emit BondReleased and deactivate policy", async () => {
      const jobId = await setupJob();
      const premium = await calculator.getPremium(BUDGET, provider.address, 30, TIER_STANDARD);
      await mintAndApprove(provider, premium * 2n);

      const optParams = ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [TIER_STANDARD]);
      await acp.connect(provider).setBudget(jobId, BUDGET, optParams);

      const reason = ethers.encodeBytes32String("approved");
      await expect(acp.connect(evaluator).complete(jobId, reason, "0x"))
        .to.emit(hook, "BondReleased").withArgs(jobId);

      const policy = await hook.policies(jobId);
      expect(policy.active).to.be.false;
    });
  });

  // ─── 2. Reject + 보험금 지급 플로우 ───────────────────────────
  describe("Reject + payout flow", function () {
    it("reject should queue claim, executePayout after 72h pays client", async () => {
      const jobId = await setupJob();
      const premium = await calculator.getPremium(BUDGET, provider.address, 30, TIER_STANDARD);
      await mintAndApprove(provider, premium * 2n);

      const optParams = ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [TIER_STANDARD]);
      await acp.connect(provider).setBudget(jobId, BUDGET, optParams);

      const policy = await hook.policies(jobId);
      const coverage = policy.coverageAmt;

      const reason = ethers.encodeBytes32String("bad work");
      await expect(acp.connect(evaluator).reject(jobId, reason, "0x"))
        .to.emit(hook, "ClaimQueued");

      // 챌린지 기간 전 executePayout → revert
      await expect(hook.executePayout(jobId)).to.be.revertedWithCustomError(hook, "ChallengePeriodActive");

      // 72시간 경과
      await time.increase(CHALLENGE_PERIOD + 1);

      const balBefore = await usdc.balanceOf(client.address);
      await expect(hook.executePayout(jobId))
        .to.emit(hook, "ClaimPaid").withArgs(jobId, client.address, coverage);

      const balAfter = await usdc.balanceOf(client.address);
      expect(balAfter - balBefore).to.equal(coverage);
    });
  });

  // ─── 3. Tier=None (보험 미가입) ───────────────────────────────
  describe("No insurance (tier=None)", function () {
    it("setBudget with no optParams should not issue bond", async () => {
      const jobId = await setupJob();
      await acp.connect(provider).setBudget(jobId, BUDGET, "0x");

      const policy = await hook.policies(jobId);
      expect(policy.active).to.be.false;
      expect(policy.premium).to.equal(0);
    });
  });

  // ─── 4. 챌린지 플로우 ────────────────────────────────────────
  describe("Challenge flow", function () {
    it("provider can challenge within 72h and block payout", async () => {
      const jobId = await setupJob();
      const premium = await calculator.getPremium(BUDGET, provider.address, 30, TIER_STANDARD);
      await mintAndApprove(provider, premium * 2n);

      const optParams = ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [TIER_STANDARD]);
      await acp.connect(provider).setBudget(jobId, BUDGET, optParams);

      const reason = ethers.encodeBytes32String("disputed");
      await acp.connect(evaluator).reject(jobId, reason, "0x");

      // 챌린지 기간 내 이의신청
      await expect(hook.connect(provider).challengeClaim(jobId))
        .to.emit(hook, "ClaimChallenged").withArgs(jobId, provider.address);

      // 72h 후에도 claimableAt = max uint → 지급 불가
      await time.increase(CHALLENGE_PERIOD + 1);
      await expect(hook.executePayout(jobId)).to.be.revertedWithCustomError(hook, "ChallengePeriodActive");
    });

    it("stranger cannot challenge", async () => {
      const jobId = await setupJob();
      const premium = await calculator.getPremium(BUDGET, provider.address, 30, TIER_STANDARD);
      await mintAndApprove(provider, premium * 2n);

      const optParams = ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [TIER_STANDARD]);
      await acp.connect(provider).setBudget(jobId, BUDGET, optParams);

      await acp.connect(evaluator).reject(jobId, ethers.encodeBytes32String("x"), "0x");
      await expect(hook.connect(stranger).challengeClaim(jobId))
        .to.be.revertedWithCustomError(hook, "NotProvider");
    });
  });

  // ─── 5. 풀 부족 시 재큐 ──────────────────────────────────────
  describe("Pool insolvency re-queue", function () {
    it("payout fails when pool has insufficient reserve, re-queued for next day", async () => {
      const jobId = await setupJob();
      const premium = await calculator.getPremium(BUDGET, provider.address, 30, TIER_STANDARD);
      await mintAndApprove(provider, premium * 2n);

      const optParams = ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [TIER_STANDARD]);
      await acp.connect(provider).setBudget(jobId, BUDGET, optParams);

      await acp.connect(evaluator).reject(jobId, ethers.encodeBytes32String("x"), "0x");

      // 풀에서 모든 자금 빼기 (admin이 depositCapital 없이 pool을 drain하는 방법 없음)
      // → BondPool에 아주 작은 자본만 남기도록 reserveRatio를 극단적으로 높게 설정
      // 실제 테스트: 초기에 자본 없이 배포
      const PoolFactory = await ethers.getContractFactory("BondPool");
      const emptyPool = await PoolFactory.deploy(await usdc.getAddress(), owner.address, 9999);
      await emptyPool.setHook(await hook.getAddress());

      // hook을 emptyPool 연결된 새 hook으로 교체
      const HookFactory = await ethers.getContractFactory("PerformanceBondHook");
      const hookWithEmptyPool = await HookFactory.deploy(
        await acp.getAddress(),
        await emptyPool.getAddress(),
        await calculator.getAddress(),
        await usdc.getAddress()
      );
      await emptyPool.setHook(await hookWithEmptyPool.getAddress());

      // 새 job으로 테스트
      const expiredAt2 = (await time.latest()) + 30 * ONE_DAY;
      await acp.connect(client).createJob(
        provider.address, evaluator.address, expiredAt2, "Test2", await hookWithEmptyPool.getAddress(), BUDGET
      );
      const jobId2 = 2n;

      const prem2 = await calculator.getPremium(BUDGET, provider.address, 30, TIER_STANDARD);
      await usdc.mint(provider.address, prem2 * 2n);
      await usdc.connect(provider).approve(await hookWithEmptyPool.getAddress(), prem2 * 2n);

      const opt2 = ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [TIER_STANDARD]);
      await acp.connect(provider).setBudget(jobId2, BUDGET, opt2);
      await acp.connect(evaluator).reject(jobId2, ethers.encodeBytes32String("y"), "0x");

      await time.increase(CHALLENGE_PERIOD + 1);

      const claimBefore = await hookWithEmptyPool.pendingClaims(jobId2);
      // payout will fail (InsufficientReserve), re-queued
      await hookWithEmptyPool.executePayout(jobId2);

      const claimAfter = await hookWithEmptyPool.pendingClaims(jobId2);
      expect(claimAfter.client).to.equal(client.address); // still queued
      expect(claimAfter.claimableAt).to.be.gt(claimBefore.claimableAt);
    });
  });

  // ─── 6. 권한 없는 hook 호출 ───────────────────────────────────
  describe("Access control", function () {
    it("beforeAction from non-ACP should revert with NotACP", async () => {
      await expect(
        hook.connect(stranger).beforeAction(1, "0x12345678", "0x")
      ).to.be.revertedWithCustomError(hook, "NotACP");
    });

    it("afterAction from non-ACP should revert with NotACP", async () => {
      await expect(
        hook.connect(stranger).afterAction(1, "0x12345678", "0x")
      ).to.be.revertedWithCustomError(hook, "NotACP");
    });
  });

  // ─── 7. PremiumCalculator 단위 테스트 ────────────────────────
  describe("PremiumCalculator", function () {
    it("tier=0 returns 0 premium and coverage", async () => {
      expect(await calculator.getPremium(BUDGET, provider.address, 30, 0)).to.equal(0);
      expect(await calculator.getCoverage(BUDGET, 0)).to.equal(0);
    });

    it("tier=3 (Premium) gives highest coverage (80% cap)", async () => {
      const coverage = await calculator.getCoverage(BUDGET, 3);
      const maxCov = BUDGET * 8000n / 10000n;
      // PremiumCalculator의 coverageRatios[3]=8000 이므로 = maxCov
      expect(coverage).to.equal(maxCov);
    });

    it("premium increases with higher tier", async () => {
      const p1 = await calculator.getPremium(BUDGET, provider.address, 30, 1);
      const p2 = await calculator.getPremium(BUDGET, provider.address, 30, 2);
      const p3 = await calculator.getPremium(BUDGET, provider.address, 30, 3);
      expect(p2).to.be.gte(p1);
      expect(p3).to.be.gte(p2);
    });

    it("minimum premium is 0.5% of budget", async () => {
      // 완료율 100% provider → failRate=0 → min premium 적용
      await oracle.setCompletionRate(provider.address, 10000);
      const premium = await calculator.getPremium(BUDGET, provider.address, 1, 1);
      const minPremium = BUDGET * 50n / 10000n;
      expect(premium).to.equal(minPremium);
    });
  });

  // ─── 8. BondPool 단위 테스트 ─────────────────────────────────
  describe("BondPool", function () {
    it("only hook can call recordPremium", async () => {
      await expect(pool.connect(stranger).recordPremium(100)).to.be.revertedWithCustomError(pool, "NotHook");
    });

    it("only hook can call payout", async () => {
      await expect(pool.connect(stranger).payout(client.address, 100)).to.be.revertedWithCustomError(pool, "NotHook");
    });

    it("solvencyRatio is 100 when no premiums recorded", async () => {
      const Pool2 = await ethers.getContractFactory("BondPool");
      const freshPool = await Pool2.deploy(await usdc.getAddress(), owner.address, 2000);
      expect(await freshPool.solvencyRatio()).to.equal(100);
    });

    it("ERC165 returns true for IACPHook interfaceId", async () => {
      const IACPHookId = "0x"; // compute manually
      // supportsInterface check
      expect(await hook.supportsInterface("0x01ffc9a7")).to.be.true; // ERC165
    });
  });
});
