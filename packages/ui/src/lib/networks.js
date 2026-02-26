const NETWORKS = {
  '167000': {
    name: 'Taiko Mainnet',
    explorer: 'https://taikoscan.io',
    rpc: 'https://rpc.taiko.xyz',
  },
  '167013': {
    name: 'Taiko Hoodi',
    explorer: 'https://hoodi.taikoscan.io',
    rpc: 'https://rpc.hoodi.taiko.xyz',
  },
};

export function networkName(chainId) {
  return NETWORKS[chainId]?.name || `Chain ${chainId}`;
}

export function explorerUrl(chainId) {
  return NETWORKS[chainId]?.explorer || '';
}

export function defaultRpc(chainId) {
  return NETWORKS[chainId]?.rpc || '';
}

export function explorerEntityUrl(chainId, entity, value) {
  const base = explorerUrl(chainId);
  return base ? `${base}/${entity}/${value}` : '#';
}
