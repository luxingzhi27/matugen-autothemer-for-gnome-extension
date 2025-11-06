import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

export default class MatugenAutoThemer extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._backgroundSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
        this._signalIds = [];
        this._isRunning = false;
        this._rerunRequested = false;
        this._defaultMatugenConfig = GLib.build_filenamev([this.path, 'matugen', 'config.toml']);

    this._signalIds.push([this._backgroundSettings, this._backgroundSettings.connect('changed::picture-uri', () => this._triggerThemeGeneration())]);
    this._signalIds.push([this._backgroundSettings, this._backgroundSettings.connect('changed::picture-uri-dark', () => this._triggerThemeGeneration())]);
    this._signalIds.push([this._settings, this._settings.connect('changed::color-mode', () => this._triggerThemeGeneration())]);
    this._signalIds.push([this._settings, this._settings.connect('changed::matugen-flavor', () => this._triggerThemeGeneration())]);
    this._signalIds.push([this._settings, this._settings.connect('changed::matugen-config', () => this._triggerThemeGeneration())]);

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
        this._isRunning = false;
        this._rerunRequested = false;
    this._defaultMatugenConfig = null;
    }

    _triggerThemeGeneration() {
        if (this._isRunning) {
            this._rerunRequested = true;
            return;
        }

        this._isRunning = true;
        this._runWorkflow().catch(error => {
            logError(error, 'Matugen Auto-Themer');
            Main.notify('Matugen Auto-Themer', error.message ?? 'Theme update failed.');
        }).finally(() => {
            this._isRunning = false;
            if (this._rerunRequested) {
                this._rerunRequested = false;
                this._triggerThemeGeneration();
            }
        });
    }

    async _runWorkflow() {
        const mode = this._getSelectedMode();
        const wallpaperPath = this._getWallpaperPath(mode);
        if (!wallpaperPath) {
            throw new Error('No wallpaper selected for the current mode.');
        }

    await this._runMatugen(wallpaperPath, mode);
    await this._applyInterfaceMode(mode);
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
        const typeSetting = (this._settings.get_string('matugen-flavor') || '').trim();
    const configSetting = (this._settings.get_string('matugen-config') || '').trim();

        if (!matugenPath || !GLib.file_test(matugenPath, GLib.FileTest.IS_EXECUTABLE)) {
            throw new Error(`Configured matugen executable is not valid: ${matugenPath}`);
        }

        const argv = [matugenPath, 'image', wallpaperPath, '--mode', mode];

        const normalizedType = this._normalizeMatugenType(typeSetting);
        if (normalizedType) {
            argv.push('-t', normalizedType);
        }

        let configPath = this._expandPath(configSetting);
        if (!configPath || configPath.length === 0) {
            if (this._defaultMatugenConfig && GLib.file_test(this._defaultMatugenConfig, GLib.FileTest.EXISTS)) {
                configPath = this._defaultMatugenConfig;
            }
        }

        if (configPath) {
            argv.push('-c', configPath);
        }

        const { stdout } = await this._runProcess(argv);
        if (stdout.trim().length > 0) {
            log(`matugen output: ${stdout.trim()}`);
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
            throw new Error(stderrText.trim().length > 0 ? stderrText.trim() : `matugen exited with status ${exitStatus}`);
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

    async _applyInterfaceMode(mode) {
        let gtkTheme = `adw-gtk3-${mode}`;
        if (mode=='light'){
            gtkTheme = `adw-gtk3`;
        }
        const colorScheme = `prefer-${mode}`;

        try {
            await this._runProcess(['gsettings', 'set', 'org.gnome.desktop.interface', 'gtk-theme', gtkTheme]);
        } catch (error) {
            logError(error, 'Matugen Auto-Themer: failed to set gtk-theme');
        }

        try {
            await this._runProcess(['gsettings', 'set', 'org.gnome.desktop.interface', 'color-scheme', colorScheme]);
        } catch (error) {
            logError(error, 'Matugen Auto-Themer: failed to set color-scheme');
        }
    }
}
