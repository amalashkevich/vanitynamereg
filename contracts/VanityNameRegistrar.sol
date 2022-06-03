// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./StringUtils.sol";

contract VanityNameRegistrar {

  using StringUtils for *;

  uint256 public MIN_COMMITMENT_AGE = 10 minutes;
  uint256 public MAX_COMMITMENT_AGE = 10 days;
  uint256 public MIN_DURATION_MULTIPLIER = 1;

  uint256 public FEE_PER_SYMBOL = 0.01 ether;
  uint256 public LOCK_AMOUNT = 1 ether;
  uint256 public DURATION_UNIT = 365 days;

  struct Registration {
    address owner;
    uint256 expiresAt;
  }

  struct AmountLocked {
    uint256 amountLocked;
    uint256 expiresAt;
  }

  mapping (bytes32 => AmountLocked) lockedAmounts;
  mapping (bytes32 => Registration) registrar;
  mapping (bytes32 => uint256) commitments;


  event NameRegistered(string name, bytes32 indexed nameHash, address indexed owner, uint256 regFee, uint256 lockedAmount, uint256 expiresAt);
  event NameRenewed(string name, bytes32 indexed nameHash, address indexed owner, uint256 renewFee, uint256 lockedAmount, uint256 expiresAt);
  event Refunded(string name, bytes32 indexed nameHash, address indexed owner, uint256 refundedAmount, uint256 timestamp);


  function getRegFee(string memory name, uint256 durationMultiplier) view public returns (uint256) {
    return name.strlen() * FEE_PER_SYMBOL * durationMultiplier;
  }

  function prepareCommitment(string memory name, address owner, uint256 salt) pure public returns(bytes32) {
    bytes32 nameHash = keccak256(bytes(name));
    return keccak256(abi.encodePacked(nameHash, owner, salt));
  }

  function commit(bytes32 commitment) public {
    require(commitments[commitment] + MAX_COMMITMENT_AGE < block.timestamp, "Previous commitment is not expired");
    commitments[commitment] = block.timestamp;
  }

  function register(string calldata name, address owner, uint256 salt, uint256 durationMultiplier) external payable {
    bytes32 commitment = prepareCommitment(name, owner, salt);

    require(commitments[commitment] + MIN_COMMITMENT_AGE <= block.timestamp, "Cannot register before MIN_COMMITMENT_AGE");
    require(commitments[commitment] + MAX_COMMITMENT_AGE > block.timestamp, "Cannot register after MAX_COMMITMENT_AGE");
    require(durationMultiplier >= MIN_DURATION_MULTIPLIER, "durationMultiplier is too small");

    bytes32 nameHash = keccak256(bytes(name));

    Registration storage reg = registrar[nameHash];
    require(reg.expiresAt < block.timestamp, "Name is not available");

    uint256 regFee = getRegFee(name, durationMultiplier);
    require(msg.value >= regFee + LOCK_AMOUNT, "Insufficient funds");

    uint256 expiresAt = block.timestamp + DURATION_UNIT * durationMultiplier;
    registrar[nameHash] = Registration(owner, expiresAt);

    bytes32 lockedAmountKey = keccak256(abi.encodePacked(nameHash, owner));

    uint256 currentLockAmount = LOCK_AMOUNT;
    AmountLocked storage al = lockedAmounts[lockedAmountKey];
    if (al.amountLocked > 0) {
      // Amount unlocked, but balance was not refunded, can reuse the balance
      currentLockAmount = 0;
    }
    al.amountLocked = LOCK_AMOUNT;
    al.expiresAt = expiresAt;

    // Refund unused amount
    if (msg.value > regFee + currentLockAmount) {
      payable(msg.sender).transfer(msg.value - regFee - currentLockAmount);
    }
    delete commitments[commitment];

    emit NameRegistered(name, nameHash, owner, regFee, LOCK_AMOUNT, expiresAt);
  }

  function renew(string calldata name, uint256 durationMultiplier) external payable {
    require(durationMultiplier >= MIN_DURATION_MULTIPLIER, "durationMultiplier is too small");

    bytes32 nameHash = keccak256(bytes(name));
    Registration storage reg = registrar[nameHash];
    require(reg.expiresAt > block.timestamp, "Registration expired");
    require(msg.sender == reg.owner, "Only owner can renew");

    uint256 renewFee = getRegFee(name, durationMultiplier);
    require(msg.value >= renewFee, "Insufficient funds");

    uint256 newExpiresAt = reg.expiresAt + DURATION_UNIT * durationMultiplier;
    bytes32 lockedAmountKey = keccak256(abi.encodePacked(nameHash, reg.owner));

    AmountLocked storage al = lockedAmounts[lockedAmountKey];
    al.expiresAt = newExpiresAt;

    // Refund unused amount
    if (msg.value > renewFee) {
      payable(msg.sender).transfer(msg.value - renewFee);
    }

    emit NameRenewed(name, nameHash, reg.owner, renewFee, al.amountLocked, newExpiresAt);
  }

  function refund(string calldata name) external {
    bytes32 nameHash = keccak256(bytes(name));
    bytes32 lockedAmountKey = keccak256(abi.encodePacked(nameHash, msg.sender));
    AmountLocked storage al = lockedAmounts[lockedAmountKey];
    require(al.expiresAt <= block.timestamp, "Registration is not expired yet");
    uint256 amount = al.amountLocked;
    delete lockedAmounts[lockedAmountKey];
    payable(msg.sender).transfer(amount);

    Registration storage reg = registrar[nameHash];
    if (msg.sender == reg.owner) {
      // No one took this name, safe to delete
      assert(reg.expiresAt <= block.timestamp);
      delete registrar[nameHash];
    }

    emit Refunded(name, nameHash, msg.sender, amount, block.timestamp);
  }
}
