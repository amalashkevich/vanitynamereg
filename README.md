# Vanity Name Registrar

A vanity name registar system which is resistant against frontrunning.

An unregistered name can be registered for a certain amount of time by locking a certain
balance of an account. After the registration expires, the account loses ownership of the
name and his balance is unlocked. The registration can be renewed by making an on-chain
call to keep the name registered and balance locked.

The fee to register the name depends directly on the size of the name. Also, a malicious
node/validator is not be able to front-run the process by censoring transactions of an
honest user and registering its name in its own account.


## Min registration period

The minimal registration period is 365 days (`DURATION_UNIT = 365 days`).

## Registration fee

The registration fee is charged per symbol (`FEE_PER_SYMBOL = 0.01 ether`) per duration unit (`DURATION_UNIT = 365 days`). 

## Locking balance

During the whole period the amount of `LOCK_AMOUNT = 1 ether` should be locked.

## Renew

The registration can be renewed only be the name owner before its expiration by paying the registration fee for the whole extra period. The locked amount will remain locked until the registration expiration.

## Refund

Once the registration expires, the locked amount can be refunded. If it was not refunded and the same account registers it again, the locked amount will be reused.

The locked amount won't be reused for registering another name.


# Quick start

```shell
git clone https://github.com/amalashkevich/vanitynamereg.git
cd vanitynamereg
yarn

cp .env.example .env
vi .env
```

Put your values into the `.env` file.

## Compile

```shell
npx hardhat compile
```

## Running tests

```shell
npx hardhat test --network hardhat
```

## Depolyment

```shell
npx hardhat run scripts/deploy.ts --network hardhat
```

Set the desired network ('hardhat', 'localhost', 'ropsten', 'mainnet').

# Usage

## Frontrunning resistance

For protecting against the frontrunning attack the commit-reveal pattern is used.

## Step-by-step guide to registration

   1. Prepare a commitment hash.

      There are two options for this:

      - Call the `prepareCommitment()` contract method
      - Call the `prepareCommitment()` Typescript function
      
      The second option is more secure as the name is not sent over the network before calling the `register()` method.

   2. Commit

      Call the `commit()` contract method passing the commitment hash as an argument.

   3. Register

      Call the `register()` contract method with the exact same `name`, `owner`, `salt` values as at the `prepareCommitment` step within the folling time window - not earler than`MIN_COMMITMENT_AGE = 10 minutes` and not later than `MAX_COMMITMENT_AGE = 10 days`.

      Once this method is called the `name` and `salt` will be visible to everyone. Without the previous commitment a malicious node/validator could try to front-run the original transaction and register this name in its own account.

Typescript snippet for preparing a commitment.

```typescript
import { ethers } from 'ethers'

const prepareCommitment = (name: string, addr1: string, salt: number) => {
  return ethers.utils.keccak256(
    ethers.utils.solidityPack(
      ['bytes32', 'address', 'uint256'],
      [ethers.utils.keccak256(ethers.utils.toUtf8Bytes(name)), addr1, salt]
    )
  )
}
```
