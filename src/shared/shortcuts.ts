export interface ShortcutStatus {
    preferred: string;
    active: string | null;
}

// Electron accelerators read "Control+Shift+Space"; spacing the separators makes them easier to scan.
export function formatAccelerator(accelerator: string): string {
    return accelerator.replace(/\+/g, ' + ');
}
