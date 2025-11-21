// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @notice Auction contract that supports cumulative bids per address.
/// - Bidders can call `bid()` multiple times; their deposited amount accumulates in `bids[address]`
/// - The highest bidder is determined by the total deposited amount.
/// - Non-highest bidders may call `withdraw()` to retrieve their full deposited amount.
/// - Owner can `endAuction()` after time expired to claim the highest bid.
contract Auction is ReentrancyGuard {
    address public owner;
    uint public auctionEndTime;
    address public highestBidder;
    uint public highestBid;
    bool public ended;

    // total deposited per bidder (cumulative)
    mapping(address => uint) public bids;

    // track bidders for UI / admin operations
    address[] public bidders;
    mapping(address => bool) private hasBidder;

    // Events
    event BidPlaced(address indexed bidder, uint amount, uint total);
    event NewHighBid(address indexed bidder, uint total);
    event Withdrawn(address indexed bidder, uint amount);
    event AuctionEnded(address winner, uint amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyBefore(uint _time) {
        require(block.timestamp < _time, "Auction already ended");
        _;
    }

    modifier onlyAfter(uint _time) {
        require(block.timestamp >= _time, "Auction not yet ended");
        _;
    }

    constructor(uint _biddingTime) {
        owner = msg.sender;
        auctionEndTime = block.timestamp + _biddingTime;
        highestBid = 0.0001 ether; // Set initial highest bid
    }

    /// @notice Place a bid (deposit). Caller can call multiple times; their total increases.
    /// If the caller's total becomes strictly greater than the previous highest total, they become the new highest.
    function bid() public payable onlyBefore(auctionEndTime) nonReentrant {
        require(!ended, "Auction already ended");
        require(msg.value > 0, "Must send ETH to bid");

        // register bidder if first time seen
        if (!hasBidder[msg.sender]) {
            hasBidder[msg.sender] = true;
            bidders.push(msg.sender);
        }

        // compute new total and require it exceed highest if caller is NOT current highest bidder
        uint newTotal = bids[msg.sender] + msg.value;
        if (msg.sender != highestBidder) {
            require(newTotal > highestBid, "Total must exceed current highest");
        }

        // increase cumulative total for sender
        bids[msg.sender] = newTotal;
        emit BidPlaced(msg.sender, msg.value, bids[msg.sender]);

        // if caller becomes new highest (strictly greater), update highest info
        if (bids[msg.sender] > highestBid) {
            highestBid = bids[msg.sender];
            highestBidder = msg.sender;
            emit NewHighBid(msg.sender, highestBid);
        }
    }

    /// @notice Withdraw full deposited amount for caller if they are NOT the current highest bidder.
    /// This allows participants who are not first to withdraw their accumulated deposits.
    function withdraw() public nonReentrant {
        require(!ended, "Auction ended; use appropriate flow");
        require(msg.sender != highestBidder, "Highest bidder cannot withdraw");

        uint amount = bids[msg.sender];
        require(amount > 0, "No funds to withdraw");

        // zero out before transfer to prevent reentrancy
        bids[msg.sender] = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Withdraw failed");

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice End auction and transfer highest bid total to owner.
    /// After successful transfer, highest bidder's recorded bids are cleared.
    function endAuction() public onlyAfter(auctionEndTime) nonReentrant {
        require(!ended, "Auction already ended");
        ended = true;

        emit AuctionEnded(highestBidder, highestBid);

        if (highestBid > 0 && owner != address(0) && highestBidder != address(0)) {
            uint amount = bids[highestBidder];
            // clear state before external call
            bids[highestBidder] = 0;
            highestBid = 0;
            address payable to = payable(owner);

            (bool success, ) = to.call{value: amount}("");
            require(success, "Transfer to owner failed");
        }
    }

    /// @notice Owner-only: reset internal state and start a new auction.
    /// REQUIREMENT: ensure all non-owner bidders have withdrawn before calling.
    function resetAuction(uint _biddingTime) external onlyOwner nonReentrant {
        require(ended || block.timestamp >= auctionEndTime, "Auction still running");

        for (uint i = 0; i < bidders.length; i++) {
            address b = bidders[i];
            require(bids[b] == 0, "Some bidders still have deposits; require withdraw first");
            if (hasBidder[b]) {
                hasBidder[b] = false;
            }
        }

        delete bidders;
        highestBid = 0;
        highestBidder = address(0);
        ended = false;
        auctionEndTime = block.timestamp + _biddingTime;
    }

    /// @notice Utility: return number of tracked bidders
    function biddersCount() external view returns (uint) {
        return bidders.length;
    }

    /// @notice Get cumulative deposited total for a bidder
    function bidderTotal(address _bidder) external view returns (uint) {
        return bids[_bidder];
    }
}