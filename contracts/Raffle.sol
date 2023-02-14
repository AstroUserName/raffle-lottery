// SPDX-License-Identifier: MIT
// 1. Pragma
pragma solidity ^0.8.17;

// 2. Imports
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/AutomationCompatible.sol";

// 3. Interfaces, Libraries, Contracts
error Raffle__NotEnoughETHEntered();
error Raffle__NotOwner();
error Raffle__TransferFailed();
error Raffle__NotOpen();
error Raffle__UpkeepNotNeeded(uint256 currentBalance, uint256 numPlayers, uint256 raffleState);

/**@title A Lottery contract
 * @author Safar Kurbonov
 * @notice This contract is for joining to a lottery
 * @dev This implements Chainlink VRF and Chainklink Keepers
 */
contract Raffle is VRFConsumerBaseV2, AutomationCompatible {
  enum RaffleState {
    OPEN,
    CALCULATING
  }

  address payable[] private s_players;
  uint256 private immutable i_entranceFee; // Плата за участие
  address payable private immutable i_owner;

  bytes32 private immutable i_gasLane; // максимальное кол-во газа, которое мы готовы заплатить
  uint64 private immutable i_subscriptionId; // значение, которое можно получить вызовом методов(см скрипт 01-deploy) ()
  uint16 private constant REQUEST_CONFIRMATION = 3; // сколько блоков должно обработать, перед ответом, можно 3
  uint32 private constant NUM_WORDS = 1; // кол-во рандомных чисел, которое хотим получить
  uint32 private immutable i_callbackGasLimit; // сколко готовы потратиь на ф-ию fulfillRandomWords

  VRFCoordinatorV2Interface private immutable i_vrfCoordinator;

  // Lottery Variables
  address payable private s_recentWinner;
  RaffleState private s_raffleState;
  uint256 private s_lastTimeStamp;
  uint256 private immutable i_interval;

  // Events (we have none!)
  event RaffleEnter(address indexed player);
  event RequestedRaffleWinner(uint256 indexed requestId);
  event WinerPicked(address indexed winner);

  // Modifiers
  modifier onlyOwner() {
    // require(msg.sender == i_owner);
    if (msg.sender != i_owner) revert Raffle__NotOwner();
    _;
  }

  constructor(
    address _vrfCoordinator,
    uint256 _entranceFee,
    bytes32 _gasLane,
    uint64 _subscriptionId,
    uint32 _callbackGasLimit,
    uint256 interval
  ) VRFConsumerBaseV2(_vrfCoordinator) {
    i_entranceFee = _entranceFee;
    i_owner = payable(msg.sender);
    i_vrfCoordinator = VRFCoordinatorV2Interface(_vrfCoordinator);

    i_gasLane = _gasLane;
    i_subscriptionId = _subscriptionId;
    i_callbackGasLimit = _callbackGasLimit;

    s_raffleState = RaffleState.OPEN;
    s_lastTimeStamp = block.timestamp;
    i_interval = interval;
  }

  function enterRaffle() public payable {
    if (msg.value < i_entranceFee) {
      revert Raffle__NotEnoughETHEntered();
    }
    if (s_raffleState != RaffleState.OPEN) {
      revert Raffle__NotOpen();
    }
    s_players.push(payable(msg.sender));

    emit RaffleEnter(msg.sender);
  }

  /**
   * @dev This is the function that Chainlink nodes call
   * they look for upkeeper nedeed to return true
   * The following should be true to return true
   * 1. Our time interval should have passed
   * 2. The lottery should have at least 1 player and have some ETH
   * 3. Our subscription is funded with LINK
   * 4. The lottery shoul be in an "open" state
   */

  function checkUpkeep(
    bytes memory /* checkData */
  ) public view override returns (bool upkeepNeeded, bytes memory /* performData */) {
    bool isOpen = (RaffleState.OPEN == s_raffleState);
    bool timePassed = (block.timestamp - s_lastTimeStamp) > i_interval;
    bool hasPlayers = s_players.length > 0;
    bool hasBalance = address(this).balance > 0;
    upkeepNeeded = isOpen && timePassed && hasPlayers && hasBalance;
  }

  //   function performUpkeep(bytes calldata /* performData */) external override {}

  function performUpkeep(bytes calldata /* performData */) external override {
    (bool upkeepNeeded, ) = checkUpkeep("");
    if (!upkeepNeeded) {
      revert Raffle__UpkeepNotNeeded(
        address(this).balance,
        s_players.length,
        uint256(s_raffleState)
      );
    }
    s_raffleState = RaffleState.CALCULATING;
    uint256 requestId = i_vrfCoordinator.requestRandomWords(
      i_gasLane, // максимальное кол-во газа, которое мы готовы заплатить, butes32
      i_subscriptionId, // значение, которое можно взять в документации, можно uint64
      REQUEST_CONFIRMATION, // сколько блоков должно обработать, перед ответом, можно 3
      i_callbackGasLimit, // сколко готовы потратиь на ф-ию fulfillRandomWords
      NUM_WORDS // кол-во рандомных чисел, которое хотим получить
    );

    emit RequestedRaffleWinner(requestId);
  }

  function fulfillRandomWords(
    uint256 /*requestId*/,
    uint256[] memory randomWords
  ) internal override {
    uint256 indexOfWinner = randomWords[0] % s_players.length;
    address payable recentWinner = s_players[indexOfWinner];

    s_recentWinner = recentWinner;

    s_raffleState = RaffleState.OPEN;
    s_players = new address payable[](0);
    s_lastTimeStamp = block.timestamp;

    (bool success, ) = recentWinner.call{value: address(this).balance}("");
    if (!success) {
      revert Raffle__TransferFailed();
    }
    emit WinerPicked(recentWinner);
  }

  function getEntranceFee() public view returns (uint256) {
    return i_entranceFee;
  }

  function getPlayer(uint256 index) public view returns (address) {
    return s_players[index];
  }

  function getRecentWinner() public view returns (address) {
    return s_recentWinner;
  }

  function getRaffleState() public view returns (RaffleState) {
    return s_raffleState;
  }

  function getNumWords() public pure returns (uint256) {
    return NUM_WORDS;
  }

  function getNumberOfPlayers() public view returns (uint256) {
    return s_players.length;
  }

  function getLatestTimestamp() public view returns (uint256) {
    return s_lastTimeStamp;
  }
}
