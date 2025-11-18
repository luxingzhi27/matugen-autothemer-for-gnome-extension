import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const STATUS_AREA_ID = 'matugen-autothemer-indicator';
const AVAILABLE_FLAVORS = [
    'scheme-tonal-spot',
    'scheme-vibrant',
    'scheme-expressive',
    'scheme-fruit-salad',
    'scheme-content',
    'scheme-monochrome',
    'scheme-neutral',
    'scheme-rainbow',
    'scheme-fidelity',
];

Gio._promisify(
    Gio.Subprocess.prototype,
    'communicate_utf8_async',
    'communicate_utf8_finish'
);

export default class MatugenAutoThemer extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._backgroundSettings = new Gio.Settings({
            schema: 'org.gnome.desktop.background',
        });
        this._interfaceSettings = new Gio.Settings({
            schema: 'org.gnome.desktop.interface',
        });

        this._signalIds = [];
        this._busy = false; 
        this._rerunRequested = false;
        this._defaultMatugenConfig = GLib.build_filenamev([
            this.path,
            'matugen',
            'config.toml',
        ]);
        this._panelButton = null;
        this._panelIcon = null;
        this._modeItems = null;
        this._flavorItems = null;

        this._signalIds.push([
            this._backgroundSettings,
            this._backgroundSettings.connect('changed::picture-uri', () =>
                this._triggerThemeGeneration()
            ),
        ]);
        this._signalIds.push([
            this._backgroundSettings,
            this._backgroundSettings.connect('changed::picture-uri-dark', () =>
                this._triggerThemeGeneration()
            ),
        ]);
        this._signalIds.push([
            this._settings,
            this._settings.connect('changed::color-mode', () => {
                this._updateMenuState();
                this._triggerThemeGeneration();
            }),
        ]);
        this._signalIds.push([
            this._settings,
            this._settings.connect('changed::matugen-flavor', () => {
                this._updateMenuState();
                this._triggerThemeGeneration();
            }),
        ]);
        this._signalIds.push([
            this._settings,
            this._settings.connect('changed::matugen-config', () =>
                this._triggerThemeGeneration()
            ),
        ]);

        this._createPanelButton();

        this._triggerThemeGeneration();
    }

    disable() {
        if (this._signalIds) {
            for (const [object, id] of this._signalIds) {
                if (object) {
                    object.disconnect(id);
                }
            }
            this._signalIds = null;
        }

        this._settings = null;
        this._backgroundSettings = null;
        this._interfaceSettings = null;
        this._busy = false;
        this._rerunRequested = false;
        this._defaultMatugenConfig = null;
        if (this._panelButton) {
            this._panelButton.destroy();
            this._panelButton = null;
        }
        this._panelIcon = null;
        this._modeItems = null;
        this._flavorItems = null;
    }

    _triggerThemeGeneration() {
        if (this._busy) {
            this._rerunRequested = true;
            return;
        }

        this._busy = true;
        this._runWorkflow()
            .catch((error) => {
                console.error(`[Matugen Auto-Themer] Error: ${error.message}`);
                Main.notify(
                    'Matugen Auto-Themer',
                    error.message ?? 'Theme update failed.'
                );
            })
            .finally(() => {
                this._busy = false;
                if (this._rerunRequested) {
                    this._rerunRequested = false;
                    this._triggerThemeGeneration();
                }
            });
    }

    _createPanelButton() {
        if (this._panelButton) {
            this._panelButton.destroy();
        }

        this._panelButton = new PanelMenu.Button(0.0, 'Matugen Auto-Themer');
        this._panelIcon = new St.Icon({
            icon_name: 'preferences-desktop-theme-symbolic',
            style_class: 'system-status-icon',
        });
        this._panelButton.add_child(this._panelIcon);

        this._buildPanelMenu();
        Main.panel.addToStatusArea(STATUS_AREA_ID, this._panelButton);
        this._updateMenuState();
    }

    _buildPanelMenu() {
        if (!this._panelButton) {
            return;
        }

        const menu = this._panelButton.menu;
        menu.removeAll();

        this._modeItems = new Map();
        this._flavorItems = new Map();

        const modeLabel = new PopupMenu.PopupMenuItem('Color mode', {
            reactive: false,
        });
        modeLabel.setSensitive(false);
        menu.addMenuItem(modeLabel);

        const modes = [
            ['dark', 'Dark mode'],
            ['light', 'Light mode'],
        ];

        for (const [mode, label] of modes) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => {
                this._settings.set_string('color-mode', mode);
            });
            menu.addMenuItem(item);
            this._modeItems.set(mode, item);
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const flavorLabel = new PopupMenu.PopupMenuItem('Scheme type', {
            reactive: false,
        });
        flavorLabel.setSensitive(false);
        menu.addMenuItem(flavorLabel);

        for (const flavor of AVAILABLE_FLAVORS) {
            const item = new PopupMenu.PopupMenuItem(this._formatFlavorLabel(flavor));
            item.connect('activate', () => {
                this._settings.set_string('matugen-flavor', flavor);
            });
            menu.addMenuItem(item);
            this._flavorItems.set(flavor, item);
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const runItem = new PopupMenu.PopupMenuItem('Run matugen now');
        runItem.connect('activate', () => {
            this._triggerThemeGeneration();
        });
        menu.addMenuItem(runItem);

        const prefsItem = new PopupMenu.PopupMenuItem('Open Preferences…');
        prefsItem.connect('activate', () => {
            this.openPreferences();
        });
        menu.addMenuItem(prefsItem);
    }

    _updateMenuState() {
        const currentMode = this._getSelectedMode();
        if (this._modeItems) {
            for (const [mode, item] of this._modeItems.entries()) {
                const ornament = mode === currentMode
                    ? PopupMenu.Ornament.DOT
                    : PopupMenu.Ornament.NONE;
                item.setOrnament(ornament);
            }
        }

        if (this._panelIcon) {
            this._panelIcon.icon_name = currentMode === 'dark'
                ? 'weather-night-symbolic'
                : 'weather-clear-symbolic';
        }

        const currentFlavor = (this._settings?.get_string('matugen-flavor') || '').trim();
        if (this._flavorItems) {
            for (const [flavor, item] of this._flavorItems.entries()) {
                const ornament = flavor === currentFlavor
                    ? PopupMenu.Ornament.DOT
                    : PopupMenu.Ornament.NONE;
                item.setOrnament(ornament);
            }
        }
    }

    _formatFlavorLabel(flavor) {
        return flavor
            .replace(/^scheme-/, '')
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, letter => letter.toUpperCase());
    }

    async _runWorkflow() {
        const mode = this._getSelectedMode();
        const wallpaperPath = this._getWallpaperPath(mode);
        if (!wallpaperPath) {
            throw new Error('No wallpaper selected for the current mode.');
        }

        await this._runMatugen(wallpaperPath, mode);
        this._applyInterfaceMode(mode);
    }

    _getSelectedMode() {
        const value = (this._settings.get_string('color-mode') || '').toLowerCase();
        return value === 'light' ? 'light' : 'dark';
    }

    _getWallpaperPath(mode) {
        let uri = null;
        if (mode === 'dark') {
            uri = this._backgroundSettings.get_string('picture-uri-dark');
        }
        if (!uri) {
            uri = this._backgroundSettings.get_string('picture-uri');
        }

        if (!uri || uri === 'none') {
            return null;
        }

        try {
            const file = Gio.File.new_for_uri(uri);
            const path = file.get_path();
            if (!path) {
                throw new Error('Wallpaper URI does not resolve to a local path.');
            }
            if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
                throw new Error(`Wallpaper file does not exist: ${path}`);
            }
            return path;
        } catch (error) {
            throw new Error(`Unable to convert wallpaper URI to path: ${uri}`);
        }
    }

    async _runMatugen(wallpaperPath, mode) {
        const matugenPath = this._settings.get_string('matugen-path');
        const typeSetting = (
            this._settings.get_string('matugen-flavor') || ''
        ).trim();
        const configSetting = (
            this._settings.get_string('matugen-config') || ''
        ).trim();

        if (
            !matugenPath ||
            !GLib.file_test(matugenPath, GLib.FileTest.IS_EXECUTABLE)
        ) {
            throw new Error(
                `Configured matugen executable is not valid: ${matugenPath}`
            );
        }

        const argv = [matugenPath, 'image', wallpaperPath, '--mode', mode];

        const normalizedType = this._normalizeMatugenType(typeSetting);
        if (normalizedType) {
            argv.push('-t', normalizedType);
        }

        let configPath = this._expandPath(configSetting);
        if (!configPath || configPath.length === 0) {
            if (
                this._defaultMatugenConfig &&
                GLib.file_test(this._defaultMatugenConfig, GLib.FileTest.EXISTS)
            ) {
                configPath = this._defaultMatugenConfig;
            }
        }

        if (configPath) {
            argv.push('-c', configPath);
        }

        const { stdout } = await this._runProcess(argv);
        if (stdout.trim().length > 0) {
            console.log(`[Matugen Auto-Themer] matugen output: ${stdout.trim()}`);
        }
    }

    async _runProcess(argv) {
        const subprocess = new Gio.Subprocess({
            argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });

        subprocess.init(null);

        const result = await subprocess.communicate_utf8_async(null, null);
        let stdout;
        let stderr;

        if (Array.isArray(result)) {
            if (result.length === 3) {
                [, stdout, stderr] = result;
            } else {
                [stdout, stderr] = result;
            }
        } else {
            stdout = result;
        }

        const exitStatus = subprocess.get_exit_status();
        const stderrText = typeof stderr === 'string' ? stderr : '';
        const stdoutText = typeof stdout === 'string' ? stdout : '';

        if (exitStatus !== 0) {
            throw new Error(
                stderrText.trim().length > 0
                    ? stderrText.trim()
                    : `matugen exited with status ${exitStatus}`
            );
        }

        return { stdout: stdoutText, stderr: stderrText };
    }

    _normalizeMatugenType(value) {
        if (!value) {
            return null;
        }

        let normalized = value.trim();
        if (normalized.length === 0) {
            return null;
        }

        normalized = normalized.replace(/_/g, '-');
        if (!normalized.startsWith('scheme-')) {
            normalized = `scheme-${normalized}`;
        }

        return normalized;
    }

    _expandPath(path) {
        if (!path) {
            return null;
        }

        if (path === '~') {
            return GLib.get_home_dir();
        }

        if (path.startsWith('~/')) {
            return GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);
        }

        return path;
    }

    // Review Fix 5: Use Gio.Settings instead of subprocess for GSettings
    _applyInterfaceMode(mode) {
        let gtkTheme = `adw-gtk3-${mode}`;
        if (mode === 'light') {
            gtkTheme = 'adw-gtk3';
        }
        const colorScheme = `prefer-${mode}`;

        try {
            this._interfaceSettings.set_string('gtk-theme', gtkTheme);
        } catch (error) {
            console.error(`[Matugen Auto-Themer] Failed to set gtk-theme: ${error}`);
        }

        // 先切换到相反的color-scheme，再切回到正确的，以确保主题样式表被刷新
        const oppositeScheme = mode === 'dark' ? 'prefer-light' : 'prefer-dark';
        try {
            this._interfaceSettings.set_string('color-scheme', oppositeScheme);
            this._interfaceSettings.set_string('color-scheme', colorScheme);
        } catch (error) {
            console.error(`[Matugen Auto-Themer] Failed to set color-scheme: ${error}`);
        }
    }
}
