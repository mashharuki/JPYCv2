'use strict';

const { task, types } = require('hardhat/config');
const fs = require('fs');
const path = require('path');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEFAULT_DEPLOYMENTS_DIR = path.join(__dirname, '..', 'deployments');

function resolveContractAddress(hre, explicit) {
  const { utils } = hre.ethers;
  if (explicit) {
    if (!utils.isAddress(explicit)) {
      throw new Error(`Invalid contract address: ${explicit}`);
    }
    const checksummed = utils.getAddress(explicit);
    if (checksummed.toLowerCase() === ZERO_ADDRESS) {
      throw new Error('Contract address must not be zero');
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

async function getTokenContract(hre, contractAddress) {
  const address = resolveContractAddress(hre, contractAddress);
  return hre.ethers.getContractAt('FiatTokenV2', address);
}

function normalizeAmount(hre, amount) {
  const value = hre.ethers.BigNumber.from(amount);
  if (value.lt(0)) {
    throw new Error('Allowance amount must be non-negative');
  }
  return value;
}

task('jpyc:configure-minter', 'Grant or update minter allowance')
  .addOptionalParam('contract', 'Proxy contract address (defaults to JPYC_PROXY or deployments)')
  .addParam('minter', 'Address to grant minter role', undefined, types.string)
  .addParam('allowance', 'Allowance amount in smallest units')
  .setAction(async ({ contract, minter, allowance }, hre) => {
    const token = await getTokenContract(hre, contract);
    const minterAddress = normalizeAddress(hre, minter, 'minter');
    const amount = normalizeAmount(hre, allowance);
    console.log(`[jpyc:configure-minter] configuring ${minterAddress} with allowance ${amount.toString()}`);
    const tx = await token.configureMinter(minterAddress, amount);
    const receipt = await tx.wait();
    console.log(`[jpyc:configure-minter] tx=${receipt.transactionHash}`);
    return receipt;
  });

task('jpyc:remove-minter', 'Revoke minter role')
  .addOptionalParam('contract', 'Proxy contract address (defaults to JPYC_PROXY or deployments)')
  .addParam('minter', 'Address to revoke', undefined, types.string)
  .setAction(async ({ contract, minter }, hre) => {
    const token = await getTokenContract(hre, contract);
    const minterAddress = normalizeAddress(hre, minter, 'minter');
    console.log(`[jpyc:remove-minter] removing ${minterAddress}`);
    const tx = await token.removeMinter(minterAddress);
    const receipt = await tx.wait();
    console.log(`[jpyc:remove-minter] tx=${receipt.transactionHash}`);
    return receipt;
  });

task('jpyc:update-roles', 'Update single-role assignments (pauser, blocklister, rescuer, allowlister, minterAdmin, owner)')
  .addOptionalParam('contract', 'Proxy contract address (defaults to JPYC_PROXY or deployments)')
  .addParam('role', 'Role to update (pauser | blocklister | rescuer | allowlister | minterAdmin | owner)', undefined, types.string)
  .addParam('address', 'New address to assign', undefined, types.string)
  .setAction(async ({ contract, role, address }, hre) => {
    const token = await getTokenContract(hre, contract);
    const newAddress = normalizeAddress(hre, address, 'role');
    const normalizedRole = role.trim().toLowerCase();

    const roleMap = {
      pauser: 'updatePauser',
      blocklister: 'updateBlocklister',
      rescuer: 'updateRescuer',
      allowlister: 'updateAllowlister',
      minteradmin: 'updateMinterAdmin',
      owner: 'transferOwnership',
    };

    const method = roleMap[normalizedRole];
    if (!method) {
      throw new Error(`Unsupported role: ${role}. Supported roles: ${Object.keys(roleMap).join(', ')}`);
    }

    console.log(`[jpyc:update-roles] calling ${method}(${newAddress})`);
    const tx = await token[method](newAddress);
    const receipt = await tx.wait();
    console.log(`[jpyc:update-roles] tx=${receipt.transactionHash}`);
    return receipt;
  });
