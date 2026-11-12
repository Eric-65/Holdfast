const env = import.meta.env

export const config = {
  /** Origin of the Holdfast API. Empty means the same site the app is served from. */
  apiBase: ((env.VITE_API_BASE as string | undefined)?.trim() || '').replace(/\/$/, ''),
  rpcUrl: (env.VITE_NIMIQ_RPC_URL as string | undefined)?.trim() || '',
  validatorsApiUrl:
    (env.VITE_VALIDATORS_API_URL as string | undefined)?.trim() ||
    'https://validators-api-mainnet.nuxt.dev/api/v1/validators',
  priceApiUrl:
    (env.VITE_PRICE_API_URL as string | undefined)?.trim() ||
    'https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2,tether&vs_currencies=usd,ngn,eur,crc,gmd',
}
