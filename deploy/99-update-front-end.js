const fs = require("fs")
const { network } = require("hardhat")

const frontEndContractsFile = "../lottery-front-upd/constants/contractAddresses.json"
const frontEndAbiFile = "../lottery-front-upd/constants/abi.json"

module.exports = async () => {
  if (process.env.UPDATE_FRONT_END) {
    console.log("Writing to front end...")
    await updateContractAddresses()
    await updateAbi()
    console.log("Front end written!")
  }
}

async function updateAbi() {
  const raffle = await ethers.getContract("Raffle")
  fs.writeFileSync(frontEndAbiFile, raffle.interface.format(ethers.utils.FormatTypes.json))
}

async function updateContractAddresses() {
  const raffle = await ethers.getContract("Raffle")
  const chainId = network.config.chainId.toString()

  const contractAddresses = JSON.parse(fs.readFileSync(frontEndContractsFile, "utf8"))
  if (chainId in contractAddresses) {
    if (!contractAddresses[chainId].includes(raffle.address)) {
      contractAddresses[chainId].push(raffle.address)
    }
  } else {
    contractAddresses[chainId] = [raffle.address]
  }
  fs.writeFileSync(frontEndContractsFile, JSON.stringify(contractAddresses))
}
module.exports.tags = ["all", "frontend"]
