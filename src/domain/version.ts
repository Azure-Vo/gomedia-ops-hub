declare const __DOMAIN_VERSION__: string | undefined;

/** Fingerprint of src/domain injected at build time (web app and Edge Function). */
export const DOMAIN_VERSION: string = typeof __DOMAIN_VERSION__ === 'string' ? __DOMAIN_VERSION__ : 'dev';
