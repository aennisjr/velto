import { describe, expect, it } from 'vitest';
import { registerFirstAvailable } from '../src/main/shortcuts.js';

describe('registerFirstAvailable', () => {
    it('uses the preferred shortcut when it is free', () => {
        const status = registerFirstAvailable(() => true, 'A', ['B']);
        expect(status).toEqual({ preferred: 'A', active: 'A' });
    });

    it('falls back when the preferred shortcut is taken', () => {
        const status = registerFirstAvailable((accelerator) => accelerator === 'B', 'A', ['B', 'C']);
        expect(status).toEqual({ preferred: 'A', active: 'B' });
    });

    it('treats a throwing registration as unavailable', () => {
        const status = registerFirstAvailable((accelerator) => {
            if (accelerator === 'A') {
                throw new Error('invalid');
            }
            return true;
        }, 'A', ['B']);
        expect(status.active).toBe('B');
    });

    it('reports no active shortcut when everything is taken', () => {
        expect(registerFirstAvailable(() => false, 'A', ['B']).active).toBeNull();
    });
});
