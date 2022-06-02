import { expect } from 'chai'
import { ethers, network } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
// eslint-disable-next-line camelcase,node/no-missing-import
import { VanityNameRegistrar, VanityNameRegistrar__factory } from '../typechain'
import { BigNumber } from 'ethers'

const timeTravel = async (addSeconds: number) => {
  await network.provider.send('evm_increaseTime', [addSeconds])
  await network.provider.send('evm_mine')
}

const getLatestBlockTimestamp = async () => {
  return (await ethers.provider.getBlock('latest')).timestamp
}

describe('VanityNameRegistrar', function () {
  let registrar: VanityNameRegistrar
  let ownerAccount: SignerWithAddress
  let account1: SignerWithAddress
  let account2: SignerWithAddress
  let lastSnapshot: any

  let name: string
  let nameHash: string
  let addr1: string
  let addr2: string
  let salt: number
  let durationMultiplier: number

  let MAX_COMMITMENT_AGE: number
  let MIN_COMMITMENT_AGE: number
  let FEE_PER_SYMBOL: BigNumber
  let AMOUNT_TO_LOCK: BigNumber

  const TWO_ETHERS = ethers.utils.parseUnits('2', 'ether')
  const ONE_ETHER = ethers.utils.parseUnits('1', 'ether')
  const ONE_YEAR = 365 * 24 * 60 * 60

  const saveState = async () => {
    lastSnapshot = await network.provider.send('evm_snapshot')
  }

  const revertState = async () => {
    await network.provider.send('evm_revert', [lastSnapshot])
    await saveState()
  }

  const prepareCommitment = (name: string, addr1: string, salt: number) => {
    return ethers.utils.keccak256(
      ethers.utils.solidityPack(
        ['bytes32', 'address', 'uint256'],
        [ethers.utils.keccak256(ethers.utils.toUtf8Bytes(name)), addr1, salt]
      )
    )
  }

  before(async () => {
    [ownerAccount, account1, account2] = await ethers.getSigners()

    const factory = (await ethers.getContractFactory(
      'VanityNameRegistrar',
      ownerAccount
      // eslint-disable-next-line camelcase
    )) as VanityNameRegistrar__factory

    registrar = await factory.deploy()
    await registrar.connect(account1)

    name = 'TestName'
    nameHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(name))
    addr1 = account1.address
    addr2 = account2.address
    salt = 20220601
    durationMultiplier = 2

    MIN_COMMITMENT_AGE = (await registrar.MIN_COMMITMENT_AGE()).toNumber()
    MAX_COMMITMENT_AGE = (await registrar.MAX_COMMITMENT_AGE()).toNumber()
    FEE_PER_SYMBOL = await registrar.FEE_PER_SYMBOL()
    AMOUNT_TO_LOCK = await registrar.LOCK_AMOUNT()

    await saveState()
  })

  beforeEach(async function () {
    await revertState()
  })

  describe('Commit', () => {
    it('prepareCommitment(): Solidity and ethers results should be equal', async () => {
      const commitment1 = await registrar.prepareCommitment(name, addr1, salt)
      const commitment2 = prepareCommitment(name, addr1, salt)
      await expect(commitment1).to.be.equal(commitment2)
    })

    it('Doesn\'t allow to commit again before MAX_COMMITMENT_AGE', async () => {
      const commitment = prepareCommitment(name, addr1, salt)
      await registrar.commit(commitment)
      await timeTravel(MAX_COMMITMENT_AGE - 10)
      const t = registrar.commit(commitment)
      await expect(t).to.be.revertedWith(
        'Previous commitment is not expired'
      )
    })

    it('Allows to commit again after MAX_COMMITMENT_AGE', async () => {
      const commitment = prepareCommitment(name, addr1, salt)
      await registrar.commit(commitment)
      await timeTravel(MAX_COMMITMENT_AGE + 10)
      const t = registrar.commit(commitment)
      await expect(t).not.to.be.reverted
    })
  })

  describe('Commit and register', () => {
    beforeEach(async () => {
      // Reset contract to account1 before each test
      registrar = await registrar.connect(account1)
    })

    it('Protects from front-running', async () => {
      // addr1 calls `commit` and after MIN_COMMITMENT_AGE calls `register` (unveiling the name)
      // addr2 calls `commit` with the same name, but the `register` call reverts
      // addr1 successfully registers the name
      let commitment = prepareCommitment(name, addr1, salt)
      await registrar.commit(commitment)

      await timeTravel(MIN_COMMITMENT_AGE + 10)

      registrar = await registrar.connect(account2)
      commitment = prepareCommitment(name, addr2, salt)
      await registrar.commit(commitment)
      const t1 = registrar.register(name, addr2, salt, durationMultiplier, {
        value: TWO_ETHERS
      })
      await expect(t1).to.be.revertedWith(
        'Cannot register before MIN_COMMITMENT_AGE'
      )

      registrar = await registrar.connect(account1)
      const t2 = await registrar.register(name, addr1, salt, durationMultiplier, {
        value: TWO_ETHERS
      })

      // Expect to be registered and NameRegistered event emitted for addr1
      const regFee = FEE_PER_SYMBOL.mul(name.length).mul(durationMultiplier)
      const expiresAt = (await registrar.DURATION_UNIT())
        .mul(durationMultiplier)
        .add(await getLatestBlockTimestamp())
      await expect(t2)
        .to.emit(registrar, 'NameRegistered')
        .withArgs(name, nameHash, addr1, regFee, AMOUNT_TO_LOCK, expiresAt)
    })

    it('Register before MIN_COMMITMENT_AGE', async () => {
      const commitment = prepareCommitment(name, addr1, salt)
      await registrar.commit(commitment)
      await timeTravel(MIN_COMMITMENT_AGE - 10)
      const t = registrar.register(name, addr1, salt, durationMultiplier)
      await expect(t).to.be.revertedWith(
        'Cannot register before MIN_COMMITMENT_AGE'
      )
    })

    it('Register after MAX_COMMITMENT_AGE', async () => {
      const commitment = prepareCommitment(name, addr1, salt)
      await registrar.commit(commitment)
      await timeTravel(MAX_COMMITMENT_AGE)
      const t = registrar.register(name, addr1, salt, durationMultiplier)
      await expect(t).to.be.revertedWith(
        'Cannot register after MAX_COMMITMENT_AGE'
      )
    })

    it('Insufficient amount for registration', async () => {
      const commitment = prepareCommitment(name, addr1, salt)
      await registrar.commit(commitment)
      await timeTravel(MIN_COMMITMENT_AGE + 10)
      const t = registrar.register(name, addr1, salt, durationMultiplier, {
        value: ONE_ETHER
      })
      await expect(t).to.be.reverted
    })

    it('Registration with valid parameters', async () => {
      const commitment = prepareCommitment(name, addr1, salt)
      await registrar.commit(commitment)
      await timeTravel(MIN_COMMITMENT_AGE + 10)
      const balanceBefore = await account1.getBalance()

      const t = await registrar.register(name, addr1, salt, durationMultiplier, {
        value: TWO_ETHERS
      })

      const regFee = FEE_PER_SYMBOL.mul(name.length).mul(durationMultiplier)
      const expiresAt = (await registrar.DURATION_UNIT())
        .mul(durationMultiplier)
        .add(await getLatestBlockTimestamp())
      await expect(t)
        .to.emit(registrar, 'NameRegistered')
        .withArgs(name, nameHash, addr1, regFee, AMOUNT_TO_LOCK, expiresAt)

      const receipt = await ethers.provider.getTransactionReceipt(t.hash)
      const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice)
      const effectiveTxCost = balanceBefore.sub(await account1.getBalance())
      const expectedTxCost = AMOUNT_TO_LOCK.add(regFee).add(gasCost)
      await expect(expectedTxCost).to.be.eq(effectiveTxCost)
    })

    it('Name is not available before the registration expired', async () => {
      const commitment = prepareCommitment(name, addr1, salt)
      await registrar.commit(commitment)

      await timeTravel(MIN_COMMITMENT_AGE + 10)

      await registrar.register(name, addr1, salt, durationMultiplier, {
        value: TWO_ETHERS
      })

      const expiresIn = (await registrar.DURATION_UNIT()).mul(durationMultiplier)
      await timeTravel(expiresIn.toNumber() - 1000)

      // Use another account
      registrar = await registrar.connect(account2)
      await registrar.commit(commitment)
      await timeTravel(MIN_COMMITMENT_AGE + 10)
      const t = registrar.register(name, addr1, salt, durationMultiplier, {
        value: TWO_ETHERS
      })
      await expect(t).to.be.revertedWith('Name is not available')
    })

    it('Name is available after the registration expired', async () => {
      const commitment1 = prepareCommitment(name, addr1, salt)
      await registrar.commit(commitment1)

      await timeTravel(MIN_COMMITMENT_AGE + 10)

      await registrar.register(name, addr1, salt, durationMultiplier, {
        value: TWO_ETHERS
      })

      const expiresIn = ((await registrar.DURATION_UNIT()).mul(durationMultiplier))
      await timeTravel(expiresIn.toNumber() + 10)

      registrar = await registrar.connect(account2)
      const addr2 = account2.address
      const commitment2 = prepareCommitment(name, addr2, salt)
      await registrar.commit(commitment2)

      await timeTravel(MIN_COMMITMENT_AGE + 10)

      const t = await registrar.register(name, addr2, salt, durationMultiplier, {
        value: TWO_ETHERS
      })
      const regFee = FEE_PER_SYMBOL.mul(name.length).mul(durationMultiplier)
      const expiresAt = ((await registrar.DURATION_UNIT()).mul(durationMultiplier))
        .add(await getLatestBlockTimestamp())
      await expect(t)
        .to.emit(registrar, 'NameRegistered')
        .withArgs(name, nameHash, addr2, regFee, AMOUNT_TO_LOCK, expiresAt)
    })
  })

  describe('Renew', () => {
    let expiresAt: BigNumber

    beforeEach(async () => {
      // Reset contract to the account1 before each test
      registrar = await registrar.connect(account1)

      // Register a name for account1
      const commitment = prepareCommitment(name, addr1, salt)
      await registrar.commit(commitment)

      await timeTravel(MIN_COMMITMENT_AGE + 10)

      await registrar.register(name, addr1, salt, durationMultiplier, {
        value: TWO_ETHERS
      })
      expiresAt = (await registrar.DURATION_UNIT())
        .mul(durationMultiplier)
        .add(await getLatestBlockTimestamp())
    })

    it('Owner can renew', async () => {
      await timeTravel(ONE_YEAR)

      const balanceBefore = await account1.getBalance()
      const t = await registrar.renew(name, durationMultiplier, { value: ONE_ETHER })

      const renewFee = FEE_PER_SYMBOL.mul(name.length).mul(durationMultiplier)
      const newExpiresAt = expiresAt.add((await registrar.DURATION_UNIT()).mul(durationMultiplier))
      await expect(t)
        .to.emit(registrar, 'NameRenewed')
        .withArgs(name, nameHash, addr1, renewFee, AMOUNT_TO_LOCK, newExpiresAt)

      const receipt = await ethers.provider.getTransactionReceipt(t.hash)
      const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice)
      const effectiveTxCost = balanceBefore.sub(await account1.getBalance())
      const expectedTxCost = renewFee.add(gasCost)
      await expect(expectedTxCost).to.be.eq(effectiveTxCost)
    })

    it('Not owner cannot renew', async () => {
      await timeTravel(ONE_YEAR)

      registrar = await registrar.connect(account2)
      const t = registrar.renew(name, durationMultiplier, { value: ONE_ETHER })
      await expect(t).to.be.revertedWith('Only owner can renew')
    })

    it('Even owner cannot renew after the registration is expired', async () => {
      await timeTravel(ONE_YEAR * 2 + 100)

      const t = registrar.renew(name, durationMultiplier, { value: ONE_ETHER })
      await expect(t).to.be.revertedWith('Registration expired')
    })
  })

  describe('Refund', () => {
    beforeEach(async () => {
      // Reset contract to the account1 before each test
      registrar = await registrar.connect(account1)

      // Register for account1
      const commitment = prepareCommitment(name, addr1, salt)
      await registrar.commit(commitment)

      await timeTravel(MIN_COMMITMENT_AGE + 10)

      await registrar.register(name, addr1, salt, durationMultiplier, {
        value: TWO_ETHERS
      })
    })

    it('Happy path for refund', async () => {
      await timeTravel(2 * ONE_YEAR + 10)

      const balanceBefore = await account1.getBalance()
      const t = await registrar.refund(name)
      const refundedAmount = (await account1.getBalance()).sub(balanceBefore)
      const receipt = await ethers.provider.getTransactionReceipt(t.hash)
      const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice)
      await expect(refundedAmount).to.be.eq(AMOUNT_TO_LOCK.sub(gasCost))

      await expect(t)
        .to.emit(registrar, 'Refunded')
        .withArgs(name, nameHash, addr1, AMOUNT_TO_LOCK, await getLatestBlockTimestamp())
    })

    it('Cannot refund before expired', async () => {
      await timeTravel(2 * ONE_YEAR - 10)

      const t = registrar.refund(name)
      await expect(t).to.be.revertedWith('Registration is not expired yet')
    })

    it('Same account registers again after expiration', async () => {
      // The locked amount should be reused
      await timeTravel(2 * ONE_YEAR + 10)

      // Register again for account1
      const commitment = prepareCommitment(name, addr1, salt)
      await registrar.commit(commitment)

      await timeTravel(MIN_COMMITMENT_AGE + 10)

      const balanceBefore = await account1.getBalance()
      const t = await registrar.register(name, addr1, salt, durationMultiplier, {
        value: TWO_ETHERS
      })

      const regFee = FEE_PER_SYMBOL.mul(name.length).mul(durationMultiplier)
      const expiresAt = (await registrar.DURATION_UNIT())
        .mul(durationMultiplier)
        .add(await getLatestBlockTimestamp())
      await expect(t)
        .to.emit(registrar, 'NameRegistered')
        .withArgs(name, nameHash, addr1, regFee, AMOUNT_TO_LOCK, expiresAt)

      const receipt = await ethers.provider.getTransactionReceipt(t.hash)
      const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice)
      const effectiveTxCost = balanceBefore.sub(await account1.getBalance())
      const expectedTxCost = (regFee).add(gasCost)
      await expect(expectedTxCost).to.be.eq(effectiveTxCost)
    })

    it('Another account registers again after expiration', async () => {
      // The locked amount should be reused
      await timeTravel(2 * ONE_YEAR + 10)

      // Use account2
      registrar = await registrar.connect(account2)
      // Register for account2
      const commitment = prepareCommitment(name, addr2, salt)
      await registrar.commit(commitment)

      await timeTravel(MIN_COMMITMENT_AGE + 10)

      const balanceBefore = await account2.getBalance()
      const t = await registrar.register(name, addr2, salt, durationMultiplier, {
        value: TWO_ETHERS
      })

      const regFee = FEE_PER_SYMBOL.mul(name.length).mul(durationMultiplier)
      const expiresAt = (await registrar.DURATION_UNIT())
        .mul(durationMultiplier)
        .add(await getLatestBlockTimestamp())
      await expect(t)
        .to.emit(registrar, 'NameRegistered')
        .withArgs(name, nameHash, addr2, regFee, AMOUNT_TO_LOCK, expiresAt)

      const receipt = await ethers.provider.getTransactionReceipt(t.hash)
      const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice)
      const effectiveTxCost = balanceBefore.sub(await account2.getBalance())
      const expectedTxCost = AMOUNT_TO_LOCK.add(regFee).add(gasCost)
      await expect(expectedTxCost).to.be.eq(effectiveTxCost)

      registrar = await registrar.connect(account1)
      // account1 still can refund
      const t1 = await registrar.refund(name)
      await expect(t1)
        .to.emit(registrar, 'Refunded')
        .withArgs(name, nameHash, addr1, AMOUNT_TO_LOCK, await getLatestBlockTimestamp())
    })
  })
})
