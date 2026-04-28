/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_STELLAR_NETWORK?: string;
  readonly VITE_USDC_ISSUER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
