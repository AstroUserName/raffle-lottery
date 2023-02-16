const { assert, expect } = require("chai")
const { deployments, getNamedAccounts, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("", () => {
      let raffle
      let deployer
      let VRFCoordinatorV2Mock
      let raffleEntranceFee
      let interval
      const { chainId } = network.config

      beforeEach(async () => {
        deployer = (await getNamedAccounts()).deployer
        await deployments.fixture(["all"])

        raffle = await ethers.getContract("Raffle", deployer)
        VRFCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)

        raffleEntranceFee = await raffle.getEntranceFee()
        interval = await raffle.getInterval()
      })

      describe("constructor", () => {
        it("initializes the raffle correctly", async () => {
          const raffleState = await raffle.getRaffleState()

          assert.equal(raffleState.toString(), "0")
          assert.equal(interval.toString(), networkConfig[chainId].interval)
        })
      })

      describe("enterRaffle", () => {
        it("falls if you dont send enought eth", async () => {
          await expect(raffle.enterRaffle()).to.be.revertedWith("Raffle__NotEnoughETHEntered()")
        })

        it("records players when they enter", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          const playerFromContract = await raffle.getPlayer(0)
          assert.equal(deployer, playerFromContract)
        })

        it("emit event on enter", async () => {
          await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
            raffle,
            "RaffleEnter"
          )
        })

        it("doesnt allow entrance when raffle is calculating", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.send("evm_mine", [])

          // we pretend to be a Chainlink Keeper
          await raffle.performUpkeep([])
          await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
            "Raffle__NotOpen()"
          )
        })

        describe("checkUpkeep", () => {
          it("returns false if people havent ent eny ETH", async () => {
            await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
            await network.provider.send("evm_mine", [])

            const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
            assert.equal(upkeepNeeded, false)
          })

          it("returns false if status its not Open", async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
            await network.provider.send("evm_mine", [])

            await raffle.performUpkeep([])

            const raffleState = await raffle.getRaffleState()
            const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
            assert.equal(raffleState.toString(), "1")
            assert.equal(upkeepNeeded, false)
          })

          it("returns false if enough time hasn't passed", async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
            await network.provider.request({ method: "evm_mine", params: [] })
            const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
            assert(!upkeepNeeded)
          })
          it("returns true if enough time has passed, has players, eth, and is open", async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
            await network.provider.request({ method: "evm_mine", params: [] })
            const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
            assert(upkeepNeeded)
          })
        })

        describe("performUpkeep", () => {
          it("can only run if checkUpkeep true", async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
            await network.provider.request({ method: "evm_mine", params: [] })

            const tx = await raffle.performUpkeep([])
            assert(tx)
          })

          it("reverts with Raffle__UpkeepNotNeeded if checkUpkeep false", async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            await network.provider.request({ method: "evm_mine", params: [] })

            const playersLength = await raffle.getNumberOfPlayers()
            const raffleState = await raffle.getRaffleState()
            const raffleBalance = await ethers.provider.getBalance(raffle.address)

            await expect(raffle.performUpkeep([])).to.be.revertedWith(
              `Raffle__UpkeepNotNeeded(${raffleBalance}, ${playersLength}, ${raffleState})`
            )
          })

          it("update state, make a request and emit event", async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
            await network.provider.request({ method: "evm_mine", params: [] })

            let txResponse

            await expect((txResponse = await raffle.performUpkeep([]))).to.emit(
              raffle,
              "RequestedRaffleWinner"
            )
            const txReceipt = await txResponse.wait(1)
            const requestId = txReceipt.events[1].args.requestId
            const raffleState = await raffle.getRaffleState()

            assert.equal(raffleState, "1")
            assert(requestId.toNumber() > 0)
          })
        })

        describe("fulfillRandomWords", () => {
          beforeEach(async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
            await network.provider.request({ method: "evm_mine", params: [] })
          })
          it("can be called after performUpkeep", async () => {
            await expect(
              VRFCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
            ).to.be.revertedWith("nonexistent request")
            await expect(
              VRFCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
            ).to.be.revertedWith("nonexistent request")
          })
          // SUPER MASSIVE TEST
          it("picks a winner, reset the lottery, and send money", async () => {
            const additionalEntrants = 3
            const startingAccountIndex = 1 // deployer = 0

            const signers = await ethers.getSigners()

            for (let i = startingAccountIndex; i < additionalEntrants + startingAccountIndex; i++) {
              await raffle.connect(signers[i])
              await raffle.enterRaffle({ value: raffleEntranceFee })
            }
            const startingTimeStamp = await raffle.getLatestTimestamp()

            await new Promise(async (res, rej) => {
              raffle.once("WinerPicked", async () => {
                const recentWinner = await raffle.getRecentWinner()
                const raffleState = await raffle.getRaffleState()
                const endingTimeStamp = await raffle.getLatestTimestamp()

                await expect(raffle.getPlayer(0)).to.be.reverted
                assert.equal(raffleState.toNumber(), 0)
                assert(endingTimeStamp > startingTimeStamp)
              })

              const txResponse = await raffle.performUpkeep([])
              const txReceipt = await txResponse.wait(1)

              await VRFCoordinatorV2Mock.fulfillRandomWords(
                txReceipt.events[1].args.requestId,
                raffle.address
              )

              res()
            })
          })
        })
      })
    })
