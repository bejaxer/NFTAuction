// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.7;

import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import '@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol';

contract NFTAuction is ReentrancyGuard, ERC721Holder {
    using SafeERC20 for IERC20;

    event SaleRequested(
        address indexed seller,
        uint256 indexed tokenId,
        uint256 duration,
        uint256 reservePrice,
        uint256 bidIncrement
    );
    event SaleCancelled(uint256 indexed tokenId);
    event Bid(
        address indexed bidder,
        uint256 indexed tokenId,
        uint256 bidAmount
    );
    event Purchased(
        address indexed seller,
        address indexed buyer,
        uint256 indexed tokenId,
        uint256 price
    );

    struct AuctionSaleInfo {
        address seller; // Seller address
        uint256 startAt; // Auction start timestamp, when first bid placed
        uint256 duration; // Auction duration
        uint256 reservePrice; // minimum first bid
        uint256 bidIncrement; // minimum increment for the next bid (e.g 5%)
    }

    struct AuctionSaleState {
        address bidder; // Bidder address
        uint256 bidAmount; // Bid price
    }

    IERC721 public nft;
    mapping(uint256 => AuctionSaleInfo) public saleInfo;
    mapping(uint256 => AuctionSaleState) public saleState;

    uint256 public constant MULTIPLIER = 10000; // 100%

    constructor(IERC721 _nft) {
        nft = _nft;
    }

    /** @notice request sale
     *  @param _tokenId tokenID for sale
     *  @param _duration Auction duration
     *  @param _reservePrice minimum first bid
     *  @param _bidIncrement minimum increment for the next bid (e.g 5%)
     */
    function requestSale(
        uint256 _tokenId,
        uint64 _duration,
        uint256 _reservePrice,
        uint256 _bidIncrement
    ) external nonReentrant {
        require(_duration > 0, 'invalid duration');
        require(_reservePrice > 0, 'invalid reserve price');
        require(_bidIncrement > 0, 'invalid bid increment');

        saleInfo[_tokenId] = AuctionSaleInfo({
            seller: msg.sender,
            startAt: 0,
            duration: _duration,
            reservePrice: _reservePrice,
            bidIncrement: _bidIncrement
        });

        nft.safeTransferFrom(msg.sender, address(this), _tokenId);

        emit SaleRequested(
            msg.sender,
            _tokenId,
            _duration,
            _reservePrice,
            _bidIncrement
        );
    }

    /** @notice cancel sale request
     *  @dev can cancel when there is no bid
     *  @param _tokenId tokenID to cancel
     */
    function cancelSale(uint256 _tokenId) external {
        AuctionSaleInfo storage _saleInfo = saleInfo[_tokenId];
        require(_saleInfo.seller == msg.sender, '!seller');
        require(_saleInfo.duration > 0, '!sale');
        require(saleState[_tokenId].bidder == address(0), 'has bid');

        nft.safeTransferFrom(address(this), msg.sender, _tokenId);

        delete saleInfo[_tokenId];

        emit SaleCancelled(_tokenId);
    }

    /** @notice bid for sale
     *  @param _tokenId tokenID for sale
     *  @param _amount Amount to bid
     */
    function bid(uint256 _tokenId, uint256 _amount)
        external
        payable
        nonReentrant
    {
        AuctionSaleInfo storage _saleInfo = saleInfo[_tokenId];
        AuctionSaleState storage _saleState = saleState[_tokenId];

        require(_saleInfo.duration > 0, '!sale');
        require(_amount == msg.value, 'Invalid amount');

        if (_saleState.bidAmount == 0) {
            require(_amount >= _saleInfo.reservePrice, 'Invalid price');
            _saleInfo.startAt = block.timestamp;
        } else {
            require(
                _saleInfo.startAt + _saleInfo.duration >= block.timestamp,
                '!sale'
            );
            require(
                _amount >=
                    (_saleState.bidAmount *
                        (MULTIPLIER + _saleInfo.bidIncrement)) /
                        MULTIPLIER,
                'Not higher than last bid'
            );
            (bool sent, ) = _saleState.bidder.call{value: _saleState.bidAmount}(
                ''
            );
            require(sent, 'Failed to send Ether');
        }

        _saleState.bidder = msg.sender;
        _saleState.bidAmount = _amount;

        emit Bid(msg.sender, _tokenId, _amount);
    }

    /** @notice end auction and give NFT to top bidder
     *  @param _tokenId tokenID for sale
     */
    function endAuction(uint256 _tokenId) external nonReentrant {
        AuctionSaleInfo storage _saleInfo = saleInfo[_tokenId];
        AuctionSaleState storage _saleState = saleState[_tokenId];

        require(
            block.timestamp > _saleInfo.startAt + _saleInfo.duration,
            '!ended'
        );
        require(_saleState.bidder != address(0), '!bid');

        (bool sent, ) = _saleInfo.seller.call{value: _saleState.bidAmount}('');
        require(sent, 'Failed to send Ether');

        nft.safeTransferFrom(address(this), _saleState.bidder, _tokenId);

        emit Purchased(
            _saleInfo.seller,
            _saleState.bidder,
            _tokenId,
            _saleState.bidAmount
        );

        delete saleInfo[_tokenId];
        delete saleState[_tokenId];
    }
}
