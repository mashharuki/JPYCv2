'use strict';

const fs = require('fs');
const path = require('path');
const { task, types } = require('hardhat/config');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const DEFAULT_DECIMALS = 18;
const DEFAULT_DEPLOYMENTS_DIR = path.join(__dirname, '..', 'deployments');

function resolveContractAddress(hre, explicit) {
  const { utils } = hre.ethers;
  if (explicit) {
    if (!utils.isAddress(explicit)) {
      throw new Error(`Invalid contract address: ${explicit}`);
    }
    const checksummed = utils.getAddress(explicit);
    if (checksummed.toLowerCase() === ZERO_ADDRESS) {
      throw new Error('Contract address must not be the zero address');
    }
    return checksummed;
  }

  const fromEnv = process.env.JPYC_PROXY || process.env.JPYC_CONTRACT_ADDRESS;
  if (fromEnv) {
    return resolveContractAddress(hre, fromEnv);
  }

  const latestFile = path.join(DEFAULT_DEPLOYMENTS_DIR, `${hre.network.name}-latest.json`);
  if (fs.existsSync(latestFile)) {
    const contents = fs.readFileSync(latestFile, 'utf8');
    const parsed = JSON.parse(contents);
    if (parsed && parsed.proxy) {
      return resolveContractAddress(hre, parsed.proxy);
    }
  }

  throw new Error('Unable to determine proxy address. Provide --contract or set JPYC_PROXY.');
}

function normalizeAddress(hre, value, label) {
  const { utils } = hre.ethers;
  if (!utils.isAddress(value)) {
    throw new Error(`Invalid ${label} address: ${value}`);
  }
  const checksummed = utils.getAddress(value);
  if (checksummed.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${label} address must not be zero`);
  }
  return checksummed;
}

function normalizeAmount(hre, amount, decimals, raw) {
  const { BigNumber, utils } = hre.ethers;
  if (raw) {
    return BigNumber.from(amount);
  }
  const parsedDecimals = Number(decimals ?? DEFAULT_DECIMALS);
  if (!Number.isInteger(parsedDecimals) || parsedDecimals < 0 || parsedDecimals > 255) {
    throw new Error('decimals must be an integer between 0 and 255');
  }
  return utils.parseUnits(amount, parsedDecimals);
}

async function getTokenContract(hre, contractAddress) {
  const address = resolveContractAddress(hre, contractAddress);
  return hre.ethers.getContractAt('FiatTokenV2', address);
}

task('jpyc:mint', 'Mint JPYC tokens to the specified address')
  .addOptionalParam('contract', 'Proxy contract address (defaults to JPYC_PROXY or deployments)')
  .addParam('to', 'Recipient address', undefined, types.string)
  .addParam('amount', 'Token amount (as decimal unless --raw is provided)')
  .addOptionalParam('decimals', 'Token decimals when amount is decimal', DEFAULT_DECIMALS, types.int)
  .addFlag('raw', 'Treat amount as the smallest unit (do not scale by decimals)')
  .setAction(async ({ contract, to, amount, decimals, raw }, hre) => {
    const token = await getTokenContract(hre, contract);
    const recipient = normalizeAddress(hre, to, 'recipient');
    const value = normalizeAmount(hre, amount, decimals, raw);

    console.log(`[jpyc:mint] minting ${value.toString()} to ${recipient}`);
    const tx = await token.mint(recipient, value);
    const receipt = await tx.wait();
    console.log(`[jpyc:mint] tx=${receipt.transactionHash}`);
    return receipt;
  });

task('jpyc:transfer', 'Transfer JPYC from the signer to the specified address')
  .addOptionalParam('contract', 'Proxy contract address (defaults to JPYC_PROXY or deployments)')
  .addParam('to', 'Recipient address', undefined, types.string)
  .addParam('amount', 'Token amount (as decimal unless --raw is provided)')
  .addOptionalParam('decimals', 'Token decimals when amount is decimal', DEFAULT_DECIMALS, types.int)
  .addFlag('raw', 'Treat amount as the smallest unit (do not scale by decimals)')
  .setAction(async ({ contract, to, amount, decimals, raw }, hre) => {
    const token = await getTokenContract(hre, contract);
    const recipient = normalizeAddress(hre, to, 'recipient');
    const value = normalizeAmount(hre, amount, decimals, raw);

    console.log(`[jpyc:transfer] transferring ${value.toString()} to ${recipient}`);
    const tx = await token.transfer(recipient, value);
    const receipt = await tx.wait();
    console.log(`[jpyc:transfer] tx=${receipt.transactionHash}`);
    return receipt;
  });

task('jpyc:burn', 'Burn JPYC from the signer\'s balance')
  .addOptionalParam('contract', 'Proxy contract address (defaults to JPYC_PROXY or deployments)')
  .addParam('amount', 'Token amount (as decimal unless --raw is provided)')
  .addOptionalParam('decimals', 'Token decimals when amount is decimal', DEFAULT_DECIMALS, types.int)
  .addFlag('raw', 'Treat amount as the smallest unit (do not scale by decimals)')
  .setAction(async ({ contract, amount, decimals, raw }, hre) => {
    const token = await getTokenContract(hre, contract);
    const value = normalizeAmount(hre, amount, decimals, raw);

    console.log(`[jpyc:burn] burning ${value.toString()} from signer ${await token.signer.getAddress()}`);
    const tx = await token.burn(value);
    const receipt = await tx.wait();
    console.log(`[jpyc:burn] tx=${receipt.transactionHash}`);
    return receipt;
  });
