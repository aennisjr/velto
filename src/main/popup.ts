import { BrowserWindow, nativeTheme, screen } from 'electron';
import { createSecureWindow, isQuitting } from './windows.js';

interface PopupOptions {
    route: string;
    width: number;
    height: number;
    shownEvent: string;
    topRatio: number;
}

export interface Popup {
    prepare(): void;
    show(): void;
    hide(): void;
    toggle(): void;
}

// A pre-created, hidden, frameless window so the shortcut feels instant. It hides when it loses focus.
export function createPopup({ route, width, height, shownEvent, topRatio }: PopupOptions): Popup {
    let popup: BrowserWindow | null = null;

    function ensure(): BrowserWindow {
        if (popup && !popup.isDestroyed()) {
            return popup;
        }

        const window = createSecureWindow(
            {
                width,
                height,
                show: false,
                frame: false,
                resizable: false,
                minimizable: false,
                maximizable: false,
                fullscreenable: false,
                skipTaskbar: true,
                alwaysOnTop: true,
                backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
            },
            route,
        );

        // Hiding returns Windows focus to the application that was active before the popup opened.
        window.on('blur', () => {
            if (!window.isDestroyed()) {
                window.hide();
            }
        });
        window.on('close', (event) => {
            if (!isQuitting()) {
                event.preventDefault();
                window.hide();
            }
        });
        window.on('closed', () => {
            popup = null;
        });

        popup = window;
        return window;
    }

    const hide = (): void => {
        if (popup && !popup.isDestroyed()) {
            popup.hide();
        }
    };

    const show = (): void => {
        const window = ensure();
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        const area = display.workArea;
        window.setPosition(Math.round(area.x + (area.width - width) / 2), Math.round(area.y + area.height * topRatio));
        window.show();
        window.focus();
        window.webContents.send(shownEvent);
    };

    return {
        prepare: () => void ensure(),
        show,
        hide,
        toggle: () => (popup && !popup.isDestroyed() && popup.isVisible() ? hide() : show()),
    };
}
