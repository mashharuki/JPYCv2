/**
 * @type import('hardhat/config').HardhatUserConfig
 */

require('@nomiclabs/hardhat-truffle5')
// require("@nomiclabs/hardhat-waffle")
require('@openzeppelin/hardhat-upgrades')
require('@nomiclabs/hardhat-etherscan')
require('hardhat-contract-sizer')
require('solidity-coverage')
require('dotenv').config()
require('./tasks/deploy')
require('./tasks/actions')
require('./tasks/admin')

module.exports = {
  solidity: {
    compilers: [{
      version: '0.8.11',
      settings: {
        optimizer: {
          enabled: true,
          runs: 3000,
        },
      },
    },
    {
      version: '0.4.24',
    }
  ]},

  networks: {
    hardhat: {
      chainId: 1337,
      allowUnlimitedContractSize: false,
    },
    baseSepolia: {
      url: `https://base-sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
      accounts: [process.env.PRIVATE_KEY]
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  },
}
