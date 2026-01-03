'use strict';

const fs = require('fs');
const path = require('path');
const { task, types } = require('hardhat/config');
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const REQUIRED_FIELDS = [
  'name',
  'symbol',
  'currency',
  'decimals',
  'minterAdmin',
  'pauser',
  'blocklister',
  'rescuer',
  'owner',
];

const ENV_KEYS = {
  name: 'TOKEN_NAME',
  symbol: 'TOKEN_SYMBOL',
  currency: 'TOKEN_CURRENCY',
  decimals: 'TOKEN_DECIMALS',
  minterAdmin: 'JPYC_MINTER_ADMIN',
  pauser: 'JPYC_PAUSER',
  blocklister: 'JPYC_BLOCKLISTER',
  rescuer: 'JPYC_RESCUER',
  owner: 'JPYC_OWNER',
};

task('deploy:jpycv2', 'Deploy JPYC v2 proxy')
  .addOptionalPositionalParam('targetNetwork', 'Network name to deploy against', undefined, types.string)
  .addOptionalParam('params', 'Path to deployment parameter JSON file')
  .addFlag('verify', 'Verify implementation on the block explorer after deployment')
  .addFlag('v1only', 'Skip auto-upgrade to FiatTokenV2')
  .setAction(async ({ targetNetwork, params: paramsPath, verify, v1only }, hre) => {
    if (targetNetwork && targetNetwork !== hre.network.name) {
      if (typeof hre.changeNetwork === 'function') {
        console.log(`[deploy:jpycv2] switching network to ${targetNetwork}`);
        await hre.changeNetwork(targetNetwork);
      } else {
        throw new Error(
          `Network positional argument provided (${targetNetwork}), but runtime cannot switch automatically. Re-run with --network ${targetNetwork}.`
        );
      }
    }

    const { ethers, upgrades, network } = hre;
    const [deployer] = await ethers.getSigners();
    if (!deployer) {
      throw new Error('No signer available for deployment');
    }

    const params = loadParams(paramsPath, hre);
    const FiatTokenV1 = await ethers.getContractFactory('FiatTokenV1');
    const deployArgs = [
      params.name,
      params.symbol,
      params.currency,
      params.decimals,
      params.minterAdmin,
      params.pauser,
      params.blocklister,
      params.rescuer,
      params.owner,
    ];

    console.log(`[deploy:jpycv2] deploying with deployer ${deployer.address}`);

    const proxy = await upgrades.deployProxy(
      FiatTokenV1,
      deployArgs,
      {
        kind: 'uups',
        unsafeAllow: ['constructor', 'delegatecall'], // constructors+delegatecall appear in legacy libs
      }
    );
    const receipt = await proxy.deployTransaction.wait();
    const proxyAddress = proxy.address;
    const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

    console.log(
      `[deploy:jpycv2] proxy=${proxyAddress} implementation=${implementationAddress}`
    );

    const timestamp = new Date().toISOString();
    const record = {
      network: network.name,
      deployedAt: timestamp,
      deployer: deployer.address,
      txHash: receipt.transactionHash,
      proxy: proxyAddress,
      implementation: implementationAddress,
      params,
    };

    persistDeployment(network.name, record);

    if (verify && hre.tasks['verify:verify']) {
      await verifyImplementation(hre, implementationAddress);
    }

    if (!v1only) {
      await upgradeToV2({ hre, proxyAddress, record, verify });
    }

    return record;
  });

function loadParams(paramsPath, hre) {
  const { utils } = hre.ethers;
  const source = paramsPath
    ? readConfigFile(paramsPath)
    : readFromEnv();

  REQUIRED_FIELDS.forEach((field) => {
    const value = source[field];
    if (value === undefined || value === null || String(value).trim() === '') {
      const hint = paramsPath ? `params field "${field}"` : `env var ${ENV_KEYS[field]}`;
      throw new Error(`Missing ${hint}`);
    }
  });

  const normalized = { ...source };
  normalized.decimals = Number(normalized.decimals);
  if (!Number.isInteger(normalized.decimals) || normalized.decimals < 0 || normalized.decimals > 255) {
    throw new Error('decimals must be an integer between 0 and 255');
  }

  ['minterAdmin', 'pauser', 'blocklister', 'rescuer', 'owner'].forEach((key) => {
    const candidate = String(normalized[key]).trim();
    if (!utils.isAddress(candidate)) {
      throw new Error(`Invalid address for ${key}: ${candidate}`);
    }
    const checksummed = utils.getAddress(candidate);
    if (checksummed.toLowerCase() === ZERO_ADDRESS) {
      throw new Error(`Address for ${key} must not be zero`);
    }
    normalized[key] = checksummed;
  });

  normalized.name = String(normalized.name).trim();
  normalized.symbol = String(normalized.symbol).trim();
  normalized.currency = String(normalized.currency).trim();

  return normalized;
}

function readConfigFile(rawPath) {
  const fullPath = path.resolve(process.cwd(), rawPath);
  const contents = fs.readFileSync(fullPath, 'utf8');
  return JSON.parse(contents);
}

function readFromEnv() {
  return Object.entries(ENV_KEYS).reduce((acc, [field, envKey]) => {
    if (process.env[envKey] !== undefined) {
      acc[field] = process.env[envKey];
    }
    return acc;
  }, {});
}

function persistDeployment(networkName, record) {
  const outDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const timestamp = record.deployedAt.replace(/[:]/g, '-');
  const historyFile = path.join(outDir, `${networkName}-${timestamp}.json`);
  fs.writeFileSync(historyFile, JSON.stringify(record, null, 2), 'utf8');

  const latestFile = path.join(outDir, `${networkName}-latest.json`);
  fs.writeFileSync(latestFile, JSON.stringify(record, null, 2), 'utf8');
}

async function verifyImplementation(hre, implementationAddress) {
  if (!hre.tasks['verify:verify']) {
    console.warn('[deploy:jpycv2] verification task not available, skipping');
    return;
  }
  try {
    await hre.run('verify:verify', { address: implementationAddress, constructorArguments: [] });
    console.log('[deploy:jpycv2] implementation verified');
  } catch (error) {
    console.warn(`[deploy:jpycv2] verification skipped: ${error.message}`);
  }
}

async function upgradeToV2({ hre, proxyAddress, record, verify }) {
  const { ethers, upgrades } = hre;
  console.log('[deploy:jpycv2] upgrading proxy to FiatTokenV2');
  const FiatTokenV2 = await ethers.getContractFactory('FiatTokenV2');
  const upgraded = await upgrades.upgradeProxy(
    proxyAddress,
    FiatTokenV2,
    {
      kind: 'uups',
      call: { fn: 'initializeV2', args: [] },
      unsafeAllow: ['constructor', 'delegatecall'],
    }
  );

  const upgradeTx = upgraded.deployTransaction;
  if (upgradeTx) {
    const receipt = await upgradeTx.wait();
    console.log(`[deploy:jpycv2] upgraded implementation tx=${receipt.transactionHash}`);
    record.upgradeTxHash = receipt.transactionHash;
  } else {
    console.log('[deploy:jpycv2] upgrade transaction pending or unavailable');
  }

  const newImplementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`[deploy:jpycv2] now running FiatTokenV2 implementation=${newImplementation}`);
  record.implementationV2 = newImplementation;
  record.upgradedAt = new Date().toISOString();

  if (verify) {
    await verifyImplementation(hre, newImplementation);
  }

  persistDeployment(hre.network.name, record);
}
