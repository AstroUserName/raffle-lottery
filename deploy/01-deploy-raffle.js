const { network } = require("hardhat")
const { networkConfig, developmentChains } = require("../helper-hardhat-config")
const { verify } = require("../utils/verify")

const VRF_SUB_FUND_AMOUNT = ethers.utils.parseEther("10")

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { log, deploy, get } = deployments
  const { deployer } = await getNamedAccounts()

  const { name } = network
  const { chainId } = network.config
  let vrfCoordinatorV2Address, subscriptionId, vrfCoordinatorV2Mock

  if (developmentChains.includes(name)) {
    vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock")
    vrfCoordinatorV2Address = vrfCoordinatorV2Mock.address

    const transactionResponse = await vrfCoordinatorV2Mock.createSubscription()
    const transactionReceipt = await transactionResponse.wait(1)

    subscriptionId = transactionReceipt.events[0].args.subId

    await vrfCoordinatorV2Mock.fundSubscription(subscriptionId, VRF_SUB_FUND_AMOUNT)
  } else {
    vrfCoordinatorV2Address = networkConfig[chainId].vrfCoordinatorV2
    subscriptionId = networkConfig[chainId].subscriptionId
  }

  const { entranceFee } = networkConfig[chainId]
  const { gasLane } = networkConfig[chainId]
  const { callbackGasLimit } = networkConfig[chainId]
  const { interval } = networkConfig[chainId]

  const args = [
    vrfCoordinatorV2Address,
    entranceFee,
    gasLane,
    subscriptionId,
    callbackGasLimit,
    interval,
  ]

  const raffle = await deploy("Raffle", {
    from: deployer,
    args,
    log: true,
    waitConfirmations: network.config.blockConfirmation || 1,
  })
  if (developmentChains.includes(network.name)) {
    const vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock")
    await vrfCoordinatorV2Mock.addConsumer(subscriptionId, raffle.address)
  }

  if (!developmentChains.includes(name) && process.env.ETHERSCAN_API_KEY) {
    log("verifying........")
    await verify(raffle.address, args)
  }
  log("Raffle deployed ______________")
}

module.exports.tags = ["all", "raffle"]
