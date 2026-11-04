import type { VeltoApi } from '../shared/api.js';

declare global {
    interface Window {
        velto: VeltoApi;
    }
}

export {};
