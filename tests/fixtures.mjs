// Synthetic supply fixtures only: not network observations or deployment data.
// Expected amounts are hand-worked literals, never calculated by the Worker.
export const TIME = '2026-09-09T12:00:00.000Z';
export const ORIGIN = 'https://supply-tests.example';
export const RPCS = [
  'https://arb1.arbitrum.io/rpc',
  'https://arbitrum-one-rpc.publicnode.com',
  'https://arbitrum.drpc.org',
  'https://arbitrum-one.public.blastapi.io',
  'https://1rpc.io/arb',
];
export const CONTRACT = '0xa78d8321B20c4Ef90eCd72f2588AA985A4BDb684';

// Fractions add to 2.611111110111111110 ANT. Summing before truncation
// excludes 645000002 ANT, not the 645000000 sum of truncated wallet balances.
export const BALANCES = [
  100000000123456789012345678n,
  200000000987654321098765432n,
  300000000000000000000000001n,
  40000000999999999999999999n,
  5000000500000000000000000n,
];
export const ZERO_BALANCES = [0n, 0n, 0n, 0n, 0n];
export const CIRCULATING = '554999997';
export const DETAILED = {
  total_supply: '1200000000',
  circulating_supply: '554999997',
  total_excluded: '645000002',
  excluded_wallets: [
    {
      name: 'Network Emissions',
      address: '0xdA4f3aF146f86850DE8e0D6FaE6EEe051Ad0AA44',
      purpose: 'Network rewards and emissions for node operators',
      balance: '100000000',
      balance_with_decimals: '100000000.123456789012345678',
    },
    {
      name: 'MAID Airdrop Wallet',
      address: '0x675D39cdCEA31ba8313565b03D684A3bbe183a1a',
      purpose: 'Tokens for MAID token holders airdrop',
      balance: '200000000',
      balance_with_decimals: '200000000.987654321098765432',
    },
    {
      name: 'Foundation Cold Wallet',
      address: '0x4f7B7fd0533d06D2ABFad07eAe57C9CE8E92B670',
      purpose: 'Foundation treasury and long-term reserves',
      balance: '300000000',
      balance_with_decimals: '300000000.000000000000000001',
    },
    {
      name: 'Foundation Hot Wallet',
      address: '0xd10A556E6A5111b5D4Dd5Ae06761d41F6CE1D499',
      purpose: 'Foundation operational wallet',
      balance: '40000000',
      balance_with_decimals: '40000000.999999999999999999',
    },
    {
      name: 'Shareholder NFT Contract',
      address: '0x1617C551E1d63e693b0F6B42FE5352a79f2F9961',
      purpose: 'Tokens locked in Shareholder NFT smart contract',
      balance: '5000000',
      balance_with_decimals: '5000000.500000000000000000',
    },
  ],
  timestamp: TIME,
  decimals: 18,
  token: {
    name: 'Autonomi Network Token',
    symbol: 'ANT',
    contract: CONTRACT,
    blockchain: 'Arbitrum One',
  },
};

export const TEXT_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'content-type': 'text/plain; charset=utf-8',
};
export const JSON_HEADERS = {
  'access-control-allow-origin': '*',
  'content-type': 'application/json; charset=utf-8',
};
export const SUPPLY_HEADERS = {
  ...JSON_HEADERS,
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

export const SUPPLY_ROUTES = [
  { path: '/api/circulating-supply', key: 'circulating', headers: TEXT_HEADERS,
    body: CIRCULATING, error: 'Error calculating circulating supply' },
  { path: '/api/supply', key: 'supply', headers: SUPPLY_HEADERS,
    body: JSON.stringify(DETAILED), error: 'Failed to fetch supply details' },
];
