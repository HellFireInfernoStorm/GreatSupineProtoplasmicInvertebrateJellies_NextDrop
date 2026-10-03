/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" answers every API call from the contract fixtures instead of the network. */
  readonly VITE_API_MOCK?: string;
  /** "true" shows the quick-login chips for the seeded demo accounts. */
  readonly VITE_DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
