import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject'; // 必须引入 GObject
import St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const AVAILABLE_FLAVORS = [
    'tonal-spot', 'vibrant', 'expressive', 'fruit-salad',
    'content', 'monochrome', 'neutral', 'rainbow', 'fidelity',
];

/**
 * 业务逻辑核心引擎
 * 纯 JS 类，无需 GObject 注册
 */
class ThemeEngine {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._backgroundSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
        this._interfaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
        
        this._defaultMatugenConfig = GLib.build_filenamev([extension.path, 'matugen', 'config.toml']);
        this._busy = false;
        this._rerunRequested = false;
    }

    destroy() {
        this._backgroundSettings = null;
        this._interfaceSettings = null;
        this._settings = null;
    }

    async triggerUpdate() {
        if (this._busy) {
            this._rerunRequested = true;
            return;
        }
        this._busy = true;

        try {
            await this._executeWorkflow();
        } catch (error) {
            console.error(`[Matugen] Error: ${error.message}`);
            this._notifyUser('Theme Update Failed', error.message);
        } finally {
            this._busy = false;
            if (this._rerunRequested) {
                this._rerunRequested = false;
                this.triggerUpdate();
            }
        }
    }

    async _executeWorkflow() {
        if (!await this._checkRequirements()) return;

        const mode = this._settings.get_string('color-mode') === 'light' ? 'light' : 'dark';
        let wallpaperPath = this._getWallpaperPath(mode);

        if (!wallpaperPath) {
            console.warn('[Matugen] No wallpaper found for current mode.');
            return;
        }

        try {
            wallpaperPath = await this._ensureCompatibleImage(wallpaperPath);
        } catch (e) {
            throw new Error(`Image conversion failed: ${e.message}`);
        }

        this._notifyUser('Matugen Auto-Themer', `Generating ${mode} theme...`);
        await this._runMatugenBinary(wallpaperPath, mode);
        this._applyInterfaceSettings(mode);
    }

    async _checkRequirements() {
        let matugenPath = this._settings.get_string('matugen-path');
        
        if (!matugenPath || !GLib.file_test(matugenPath, GLib.FileTest.IS_EXECUTABLE)) {
            const found = GLib.find_program_in_path('matugen');
            if (found) {
                this._settings.set_string('matugen-path', found);
                matugenPath = found;
            } else {
                throw new Error('Matugen binary not found. Please install matugen v3.0.0+.');
            }
        }

        const version = await this._getToolVersion(matugenPath);
        if (!version || this._compareVersions(version, '3.0.0') < 0) {
            throw new Error(`Matugen v${version || 'unknown'} is too old. v3.0.0+ required.`);
        }

        if (!GLib.find_program_in_path('sassc')) throw new Error('Dependency missing: sassc');
        return true;
    }

    _getWallpaperPath(mode) {
        let uri = (mode === 'dark') ? this._backgroundSettings.get_string('picture-uri-dark') : null;
        if (!uri || uri === '') uri = this._backgroundSettings.get_string('picture-uri');
        
        if (!uri || uri === 'none') return null;

        try {
            const file = Gio.File.new_for_uri(uri);
            const path = file.get_path();
            if (!path || !GLib.file_test(path, GLib.FileTest.EXISTS)) return null;

            if (path.endsWith('.xml')) {
                return this._extractImageFromXml(path);
            }
            return path;
        } catch (e) {
            return null;
        }
    }

    _extractImageFromXml(xmlPath) {
        try {
            const [success, content] = GLib.file_get_contents(xmlPath);
            if (!success) return xmlPath;
            const text = new TextDecoder('utf-8').decode(content);
            const match = text.match(/<(?:filename|file)>(.*?)<\/(?:filename|file)>/);
            if (match && match[1]) {
                let extracted = match[1].trim();
                if (!extracted.startsWith('/')) {
                    extracted = GLib.build_filenamev([GLib.path_get_dirname(xmlPath), extracted]);
                }
                if (GLib.file_test(extracted, GLib.FileTest.EXISTS)) return extracted;
            }
        } catch (e) {}
        return xmlPath;
    }

    async _ensureCompatibleImage(sourcePath) {
        if (!sourcePath.toLowerCase().endsWith('.jxl')) return sourcePath;

        if (!GLib.find_program_in_path('djxl')) {
            throw new Error('djxl (libjxl) not found, cannot process JXL wallpaper.');
        }

        const destPath = GLib.build_filenamev([GLib.get_tmp_dir(), 'matugen-temp-wallpaper.png']);
        await this._runCommand(['djxl', sourcePath, destPath]);
        return destPath;
    }

    async _runMatugenBinary(imagePath, mode) {
        const matugenPath = this._settings.get_string('matugen-path');
        const flavor = this._settings.get_string('matugen-flavor') || 'tonal-spot';
        let configPath = this._settings.get_string('matugen-config');

        const typeArg = flavor.startsWith('scheme-') ? flavor : `scheme-${flavor}`;

        if (configPath && configPath.startsWith('~/')) {
            configPath = GLib.build_filenamev([GLib.get_home_dir(), configPath.slice(2)]);
        }
        if (!configPath && GLib.file_test(this._defaultMatugenConfig, GLib.FileTest.EXISTS)) {
            configPath = this._defaultMatugenConfig;
        }

        const argv = [matugenPath, 'image', imagePath, '--mode', mode, '-t', typeArg];
        if (configPath) argv.push('-c', configPath);

        const { stdout } = await this._runCommand(argv);
        if (stdout.trim()) console.log(`[Matugen] ${stdout.trim()}`);
    }

    _applyInterfaceSettings(mode) {
        const gtkTheme = mode === 'light' ? 'adw-gtk3' : `adw-gtk3-${mode}`;
        const colorScheme = `prefer-${mode}`;
        const opposite = mode === 'dark' ? 'prefer-light' : 'prefer-dark';

        if (this._interfaceSettings.get_string('gtk-theme') !== gtkTheme) {
            this._interfaceSettings.set_string('gtk-theme', gtkTheme);
        }
        this._interfaceSettings.set_string('color-scheme', opposite);
        this._interfaceSettings.set_string('color-scheme', colorScheme);
    }

    async _runCommand(argv) {
        const proc = new Gio.Subprocess({
            argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        });
        proc.init(null);

        return new Promise((resolve, reject) => {
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    const [ok, stdout, stderr] = proc.communicate_utf8_finish(res);
                    const status = proc.get_exit_status();

                    if (status !== 0) {
                        const errorMsg = stderr ? stderr.trim() : `Exit code ${status}`;
                        reject(new Error(errorMsg));
                    } else {
                        resolve({ stdout: stdout || '', stderr: stderr || '' });
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async _getToolVersion(path) {
        try {
            const { stdout } = await this._runCommand([path, '--version']);
            const match = stdout.match(/(\d+\.\d+\.\d+)/);
            return match ? match[1] : null;
        } catch { return null; }
    }

    _compareVersions(v1, v2) {
        const p1 = v1.split('.').map(Number);
        const p2 = v2.split('.').map(Number);
        for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
            if ((p1[i] || 0) > (p2[i] || 0)) return 1;
            if ((p1[i] || 0) < (p2[i] || 0)) return -1;
        }
        return 0;
    }

    _notifyUser(title, body) {
        if (Main.notify) {
            Main.notify(title, body);
        } else {
            console.log(`[Matugen Notify] ${title}: ${body}`);
        }
    }
}

/**
 * 界面组件：状态栏图标与菜单
 * 修复：继承自 PanelMenu.Button (GObject)，必须使用 registerClass
 */
const PanelIndicator = GObject.registerClass(
class PanelIndicator extends PanelMenu.Button {
    constructor(extension, engine) {
        super(0.0, extension.metadata.name, false);
        
        this._extension = extension;
        this._engine = engine;
        this._settings = extension.getSettings();
        
        this._buildUi();
        this._buildMenu();
        
        this._settingsSignal = this._settings.connect('changed', () => this.updateUiState());
        this.updateUiState();
    }

    _buildUi() {
        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        
        const mainIconPath = GLib.build_filenamev([this._extension.path, 'icons', 'matugen-palette-symbolic.svg']);
        this._mainIcon = new St.Icon({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(mainIconPath) }),
            style_class: 'system-status-icon',
        });

        this._modeIcon = new St.Icon({
            style_class: 'system-status-icon',
            style: 'margin-left: 6px;' 
        });

        box.add_child(this._mainIcon);
        box.add_child(this._modeIcon);
        this.add_child(box);
    }

    _buildMenu() {
        this.menu.addMenuItem(new PopupMenu.PopupMenuItem('Color mode', { reactive: false, can_focus: false }));
        
        this._modeItems = new Map();
        [['dark', 'Dark mode'], ['light', 'Light mode']].forEach(([mode, label]) => {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => this._settings.set_string('color-mode', mode));
            this.menu.addMenuItem(item);
            this._modeItems.set(mode, item);
        });

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addMenuItem(new PopupMenu.PopupMenuItem('Scheme type', { reactive: false, can_focus: false }));
        
        this._flavorItems = new Map();
        AVAILABLE_FLAVORS.forEach(flavor => {
            const label = flavor.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => this._settings.set_string('matugen-flavor', flavor));
            this.menu.addMenuItem(item);
            this._flavorItems.set(flavor, item);
        });

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addAction('Run matugen now', () => this._engine.triggerUpdate());
        this.menu.addAction('Preferences…', () => this._extension.openPreferences());
    }

    updateUiState() {
        const mode = this._settings.get_string('color-mode') || 'dark';
        const flavor = this._settings.get_string('matugen-flavor') || 'tonal-spot';

        const iconName = mode === 'light' ? 'mode-light' : 'mode-dark';
        const iconPath = GLib.build_filenamev([this._extension.path, 'icons', `${iconName}-symbolic.svg`]);
        this._modeIcon.set_gicon(new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) }));

        this._modeItems.forEach((item, key) => {
            item.setOrnament(key === mode ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
        });
        this._flavorItems.forEach((item, key) => {
            item.setOrnament(key === flavor ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
        });
    }

    destroy() {
        if (this._settingsSignal) this._settings.disconnect(this._settingsSignal);
        super.destroy();
    }
});

export default class MatugenAutoThemer extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._backgroundSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
        
        this._engine = new ThemeEngine(this);
        // PanelIndicator 已经被 GObject.registerClass 注册，可以实例化
        this._indicator = new PanelIndicator(this, this._engine);
        
        Main.panel.addToStatusArea(this.metadata.uuid, this._indicator);

        this._signals = [];
        const bindSignal = (obj, signal, callback) => {
            if (obj) {
                const id = obj.connect(signal, callback);
                this._signals.push({ obj, id });
            }
        };

        bindSignal(this._backgroundSettings, 'changed::picture-uri', () => this._engine.triggerUpdate());
        //bindSignal(this._backgroundSettings, 'changed::picture-uri-dark', () => this._engine.triggerUpdate());

        bindSignal(this._settings, 'changed::color-mode', () => this._engine.triggerUpdate());
        bindSignal(this._settings, 'changed::matugen-flavor', () => this._engine.triggerUpdate());
        bindSignal(this._settings, 'changed::matugen-config', () => this._engine.triggerUpdate());

        this._engine.triggerUpdate();
    }

    disable() {
        if (this._signals) {
            this._signals.forEach(s => s.obj.disconnect(s.id));
            this._signals = [];
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._engine) {
            this._engine.destroy();
            this._engine = null;
        }

        this._settings = null;
        this._backgroundSettings = null;
    }
}