export {};
declare global {
  interface Window {
    /** Public settings served by /api/platform/config.js (safe for browsers). */
    __APP_CONFIG__?: {
      supabaseUrl: string;
      supabasePublishableKey: string;
    };
  }
}
