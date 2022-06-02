import { ethers } from 'hardhat'

async function main () {
  const contractName = 'VanityNameRegistrar'
  const contractFactory = await ethers.getContractFactory(contractName)
  const contract = await contractFactory.deploy()

  await contract.deployed()

  console.log(`${contractName} deployed to:${contract.address}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
