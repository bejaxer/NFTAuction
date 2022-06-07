import { Contract } from 'ethers';

import { NFTAuction } from '../types/contracts/NFTAuction';
import { MockNFT } from '../types/contracts/MockNFT';

const hre = require('hardhat');

export const deployContract = async <ContractType extends Contract>(
  contractName: string,
  args: any[],
  libraries?: {}
) => {
  const signers = await hre.ethers.getSigners();
  const contract = (await (
    await hre.ethers.getContractFactory(contractName, signers[0], {
      libraries: {
        ...libraries,
      },
    })
  ).deploy(...args)) as ContractType;

  return contract;
};

export const deployMockNFT = async () => {
  return await deployContract<MockNFT>('MockNFT', []);
};

export const deployNFTAuction = async (nft: any) => {
  return await deployContract<NFTAuction>('NFTAuction', [nft]);
};
