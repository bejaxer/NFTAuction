import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, utils, constants } from 'ethers';
import { NFTAuction } from '../types/contracts/NFTAuction';
import { MockNFT } from '../types/contracts/MockNFT';
import { increaseTime, deployMockNFT, deployNFTAuction } from '../helper';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';

describe('NFTAuction', function () {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let nft: MockNFT;
  let auctionSale: NFTAuction;
  const tradingFeePct = BigNumber.from('100');

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    owner = signers[0];
    alice = signers[1];
    bob = signers[2];
    carol = signers[3];

    nft = await deployMockNFT();
    auctionSale = await deployNFTAuction(nft.address);
  });

  describe('#requestSale function', () => {
    const tokenId = 0;
    const duration = BigNumber.from('3600');
    const reservePrice = utils.parseEther('1');
    const bidIncrement = BigNumber.from('50');

    beforeEach(async () => {
      await nft.mint(alice.address);
    });

    it('revert if duration is 0', async () => {
      await expect(
        auctionSale
          .connect(alice)
          .requestSale(tokenId, 0, reservePrice, bidIncrement)
      ).to.revertedWith('invalid duration');
    });

    it('revert if reserve price is 0', async () => {
      await expect(
        auctionSale
          .connect(alice)
          .requestSale(tokenId, duration, 0, bidIncrement)
      ).to.revertedWith('invalid reserve price');
    });

    it('revert if bid increment is 0', async () => {
      await expect(
        auctionSale
          .connect(alice)
          .requestSale(tokenId, duration, reservePrice, 0)
      ).to.revertedWith('invalid bid increment');
    });

    it('revert if nft not approved', async () => {
      await expect(
        auctionSale
          .connect(alice)
          .requestSale(tokenId, duration, reservePrice, bidIncrement)
      ).to.revertedWith('ERC721: transfer caller is not owner nor approved');
    });

    it('should request sale and emit SaleRequested event', async () => {
      await nft.connect(alice).approve(auctionSale.address, tokenId);
      const tx = await auctionSale
        .connect(alice)
        .requestSale(tokenId, duration, reservePrice, bidIncrement);

      const saleInfo = await auctionSale.saleInfo(tokenId);
      expect(saleInfo.seller).to.be.equal(await alice.getAddress());
      expect(saleInfo.startAt).to.be.equal(0);
      expect(saleInfo.duration).to.be.equal(duration);
      expect(saleInfo.reservePrice).to.be.equal(reservePrice);
      expect(saleInfo.bidIncrement).to.be.equal(bidIncrement);

      expect(await nft.ownerOf(tokenId)).to.be.equal(auctionSale.address);

      await expect(tx)
        .emit(auctionSale, 'SaleRequested')
        .withArgs(
          await alice.address,
          tokenId,
          duration,
          reservePrice,
          bidIncrement
        );
    });
  });

  describe('#cancelSale function', () => {
    const tokenId = 0;
    const duration = BigNumber.from('3600');
    const reservePrice = utils.parseEther('1');
    const bidIncrement = BigNumber.from('50');

    beforeEach(async () => {
      await nft.mint(alice.address);
      await nft.connect(alice).approve(auctionSale.address, tokenId);
      await auctionSale
        .connect(alice)
        .requestSale(tokenId, duration, reservePrice, bidIncrement);
    });

    it('revert if msg.sender is not seller', async () => {
      await expect(
        auctionSale.connect(bob).cancelSale(tokenId)
      ).to.revertedWith('!seller');
    });

    it('revert if there is bidder', async () => {
      await auctionSale
        .connect(bob)
        .bid(tokenId, reservePrice, { value: reservePrice });
      await expect(
        auctionSale.connect(alice).cancelSale(tokenId)
      ).to.revertedWith('has bid');
    });

    it('should cancel sale and emit SaleCancelled event', async () => {
      const tx = await auctionSale.connect(alice).cancelSale(tokenId);

      const saleInfo = await auctionSale.saleInfo(tokenId);
      expect(saleInfo.seller).to.be.equal(constants.AddressZero);
      expect(saleInfo.startAt).to.be.equal(0);
      expect(saleInfo.duration).to.be.equal(0);
      expect(saleInfo.reservePrice).to.be.equal(0);
      expect(saleInfo.bidIncrement).to.be.equal(0);

      expect(await nft.ownerOf(tokenId)).to.be.equal(alice.address);

      await expect(tx).emit(auctionSale, 'SaleCancelled').withArgs(tokenId);
    });
  });

  describe('#bid function', () => {
    const tokenId = 0;
    const duration = BigNumber.from('3600');
    const reservePrice = utils.parseEther('1');
    const bidIncrement = BigNumber.from('50');
    const multiplier = BigNumber.from('10000');

    beforeEach(async () => {
      await nft.mint(alice.address);
      await nft.connect(alice).approve(auctionSale.address, tokenId);
    });

    it('revert if NFT is not for sale', async () => {
      await expect(
        auctionSale
          .connect(bob)
          .bid(tokenId, reservePrice, { value: reservePrice })
      ).to.revertedWith('!sale');
    });

    it('revert if send less than reserve price', async () => {
      await auctionSale
        .connect(alice)
        .requestSale(tokenId, duration, reservePrice, bidIncrement);
      const bidPrice = reservePrice.sub(utils.parseEther('0.5'));
      await expect(
        auctionSale.connect(bob).bid(tokenId, bidPrice, { value: bidPrice })
      ).to.revertedWith('Invalid price');
    });

    it('revert if not send correct ether', async () => {
      await auctionSale
        .connect(alice)
        .requestSale(tokenId, duration, reservePrice, bidIncrement);
      await expect(
        auctionSale
          .connect(bob)
          .bid(tokenId, reservePrice, { value: utils.parseEther('2') })
      ).to.revertedWith('Invalid amount');
    });

    it('revert if auction ended', async () => {
      await auctionSale
        .connect(alice)
        .requestSale(tokenId, duration, reservePrice, bidIncrement);
      await auctionSale
        .connect(bob)
        .bid(tokenId, reservePrice, { value: reservePrice });
      await increaseTime(duration.add(duration).toNumber());
      await expect(
        auctionSale
          .connect(carol)
          .bid(tokenId, reservePrice.add(reservePrice), {
            value: reservePrice.add(reservePrice),
          })
      ).to.revertedWith('!sale');
    });

    it('should accept Ether bid and emit Bid event', async () => {
      await auctionSale
        .connect(alice)
        .requestSale(tokenId, duration, reservePrice, bidIncrement);
      const bidAmount = reservePrice.add(utils.parseEther('0.5'));
      const tx = await auctionSale
        .connect(bob)
        .bid(tokenId, bidAmount, { value: bidAmount });
      expect(await nft.ownerOf(tokenId)).to.be.equal(auctionSale.address);
      expect(await ethers.provider.getBalance(auctionSale.address)).to.be.equal(
        bidAmount
      );
      expect(tx)
        .to.emit(auctionSale, 'Bid')
        .withArgs(bob.address, tokenId, bidAmount);
      const saleState = await auctionSale.saleState(tokenId);
      expect(saleState.bidder).to.be.equal(bob.address);
      expect(saleState.bidAmount).to.be.equal(bidAmount);
    });

    it('should accept increment Ether bid', async () => {
      await auctionSale
        .connect(alice)
        .requestSale(tokenId, duration, reservePrice, bidIncrement);
      await auctionSale
        .connect(bob)
        .bid(tokenId, reservePrice, { value: reservePrice });
      expect(await ethers.provider.getBalance(auctionSale.address)).to.be.equal(
        reservePrice
      );

      const bidAmount = reservePrice
        .mul(multiplier.add(bidIncrement))
        .div(multiplier);

      await expect(
        auctionSale
          .connect(carol)
          .bid(tokenId, bidAmount.sub(utils.parseEther('0.5')), {
            value: bidAmount.sub(utils.parseEther('0.5')),
          })
      ).to.revertedWith('Not higher than last bid');

      const tx = await auctionSale
        .connect(carol)
        .bid(tokenId, bidAmount, { value: bidAmount });
      expect(await ethers.provider.getBalance(auctionSale.address)).to.be.equal(
        bidAmount
      );
      await expect(() => tx).to.changeEtherBalance(bob, reservePrice);
      expect(tx)
        .to.emit(auctionSale, 'Bid')
        .withArgs(carol.address, tokenId, bidAmount);
      const saleState = await auctionSale.saleState(tokenId);
      expect(saleState.bidder).to.be.equal(carol.address);
      expect(saleState.bidAmount).to.be.equal(bidAmount);
    });
  });

  describe('#endAuction function', () => {
    const tokenId = 0;
    const duration = BigNumber.from('3600');
    const reservePrice = utils.parseEther('1');
    const bidIncrement = BigNumber.from('50');
    const multiplier = BigNumber.from('10000');

    beforeEach(async () => {
      await nft.mint(alice.address);
      await nft.connect(alice).approve(auctionSale.address, tokenId);
    });

    it('revert if no bidder', async () => {
      await auctionSale
        .connect(alice)
        .requestSale(tokenId, duration, reservePrice, bidIncrement);
      await increaseTime(duration.add(duration).toNumber());
      await expect(auctionSale.endAuction(tokenId)).to.revertedWith('!bid');
    });

    it('revert if not ended yet', async () => {
      await auctionSale
        .connect(alice)
        .requestSale(tokenId, duration, reservePrice, bidIncrement);
      await auctionSale
        .connect(bob)
        .bid(tokenId, reservePrice, { value: reservePrice });
      await expect(auctionSale.endAuction(tokenId)).to.revertedWith('!ended');
    });

    it('should end auction and send NFT to top bidder and send ether to seller', async () => {
      await auctionSale
        .connect(alice)
        .requestSale(tokenId, duration, reservePrice, bidIncrement);
      await auctionSale
        .connect(bob)
        .bid(tokenId, reservePrice, { value: reservePrice });
      const bidAmount = reservePrice.add(utils.parseEther('0.5'));
      await auctionSale
        .connect(carol)
        .bid(tokenId, bidAmount, { value: bidAmount });

      await increaseTime(duration.add(duration).toNumber());

      const tx = await auctionSale.endAuction(tokenId);
      await expect(() => tx).to.changeEtherBalance(alice, bidAmount);
      expect(await nft.ownerOf(tokenId)).to.be.equal(await carol.getAddress());
      expect(tx)
        .to.emit(auctionSale, 'Purchased')
        .withArgs(alice.address, bob.address, tokenId, bidAmount);
      const saleInfo = await auctionSale.saleInfo(tokenId);
      expect(saleInfo.seller).to.be.equal(constants.AddressZero);
      expect(saleInfo.startAt).to.be.equal(0);
      expect(saleInfo.duration).to.be.equal(0);
      expect(saleInfo.reservePrice).to.be.equal(0);
      expect(saleInfo.bidIncrement).to.be.equal(0);

      const saleState = await auctionSale.saleState(tokenId);
      expect(saleState.bidder).to.be.equal(constants.AddressZero);
      expect(saleState.bidAmount).to.be.equal(0);
    });
  });
});
