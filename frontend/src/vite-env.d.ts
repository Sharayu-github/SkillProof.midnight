import 'vite/client';

/// <reference types="vite/client" />

// Midnight Lace wallet exposes `window.midnight` (declared by dapp-connector-api).
declare global {
  interface Window {
    midnight?: Record<string, unknown>;
  }
}

export {};
