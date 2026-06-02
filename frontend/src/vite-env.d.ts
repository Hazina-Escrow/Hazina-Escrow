/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_API_KEY?: string;
  readonly VITE_ENABLE_DEMO_MODE?: string;
  readonly VITE_STELLAR_NETWORK?: string;
  readonly VITE_USDC_ISSUER?: string;
  readonly VITE_WEBSOCKET_URL?: string;
  // Vite built-ins
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
