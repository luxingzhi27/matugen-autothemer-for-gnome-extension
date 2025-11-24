import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import GdkPixbuf from 'gi://GdkPixbuf';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const AVAILABLE_FLAVORS = [
    'tonal-spot',
    'vibrant',
    'expressive',
    'fruit-salad',
    'content',
    'monochrome',
    'neutral',
    'rainbow',
    'fidelity',
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
        
        // 缓存配置文件路径，避免重复构建
        this._defaultMatugenConfig = GLib.build_filenamev([
            this.path,
            'matugen',
            'config.toml',
        ]);

        this._panelButton = null;
        this._panelIcon = null;
        this._modeItems = null;
        this._flavorItems = null;

        // 监听壁纸变化
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

        // 监听插件自身的设置变化
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
        this._updateMenuState();

        // 插件启用时，立即执行一次生成流程（包含 matugen 检测）
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
        
        if (this._panelButton) {
            this._panelButton.destroy();
            this._panelButton = null;
        }
        this._panelIcon = null;
        this._mainIcon = null;
        this._modeIcon = null;
        this._modeItems = null;
        this._flavorItems = null;
    }

    // =========================================================================
    // 核心工作流与 Matugen 检测
    // =========================================================================

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

    async _runWorkflow() {
        // 1. 每次运行前先检查 matugen 环境
        if (!await this._checkRequirements()) {
            return;
        }

        // 2. 获取当前模式（由插件设置决定）
        const mode = this._getSelectedMode();
        
        // 3. 获取对应模式的壁纸路径
        let wallpaperPath = this._getWallpaperPath(mode);
        if (!wallpaperPath) {
            // 这是一个常见情况（例如未设置壁纸），警告即可，不必抛错中断
            console.warn('[Matugen] No wallpaper found for current mode.');
            return;
        }
        Main.notify(
            'Matugen Auto-Themer',
            `Generating theme for ${mode} mode using wallpaper:\n${wallpaperPath}`
        );

        // [新增] 检查是否需要转换格式 (针对 JXL)
        // 如果是 jxl，这里会返回一个临时的 png 路径；否则返回原路径
        try {
            wallpaperPath = await this._ensureCompatibleImage(wallpaperPath);
        } catch (e) {
            console.error(`[Matugen] Image conversion failed: ${e.message}`);
            // 如果转换失败，可以尝试继续用原文件，或者直接终止
            // 这里选择终止，因为 matugen 肯定读不了 jxl
            this._notifyError('Image Error', 'Failed to process JXL wallpaper.');
            return;
        }

        // 4. 生成主题
        await this._runMatugen(wallpaperPath, mode);

        // 5. 应用到系统界面（GTK主题、系统配色方案）
        this._applyInterfaceMode(mode);
    }

    async _checkRequirements() {
        // 检查 matugen要求
        let matugenPath = this._settings.get_string('matugen-path');

        // 步骤 1: 检查可执行文件是否存在
        if (!matugenPath || !GLib.file_test(matugenPath, GLib.FileTest.IS_EXECUTABLE)) {
            // 尝试自动寻找
            const foundPath = GLib.find_program_in_path('matugen');
            if (foundPath) {
                console.log(`[Matugen] Auto-detected binary at ${foundPath}, updating settings.`);
                this._settings.set_string('matugen-path', foundPath);
                matugenPath = foundPath;
            } else {
                this._notifyError(
                    'Matugen not found', 
                    'Please install matugen (v3.0.0+) or set the correct path in preferences.'
                );
                return false;
            }
        }

        // 步骤 2: 检查版本
        try {
            const version = await this._getMatugenVersion(matugenPath);
            if (!version) {
                this._notifyError('Matugen Error', 'Could not determine matugen version.');
                return false;
            }

            if (this._compareVersions(version, '3.0.0') < 0) {
                this._notifyError(
                    'Matugen Outdated', 
                    `Found matugen v${version}, but v3.0.0+ is required.`
                );
                return false;
            }
            
            return true;
        } catch (e) {
            this._notifyError('Matugen Check Failed', `Error: ${e.message}`);
        }

        //检查 djxl,sassc是否存在
        try {
            const djxlPath = GLib.find_program_in_path('djxl');
            if (!djxlPath) {
                this._notifyError(
                    'djxl not found', 
                    'Please install libjxl to handle JXL images.'
                );
                return false;
            }
            return true;
        } catch (e) {
            this._notifyError('djxl Check Failed', `Error: ${e.message}`);
        }

        try {
            const sasscPath = GLib.find_program_in_path('sassc');
            if (!sasscPath) {
                this._notifyError(
                    'sassc not found', 
                    'Please install sassc to compile theme stylesheets.'
                );
                return false;
            }
            return true;
        } catch (e) {
            this._notifyError('sassc Check Failed', `Error: ${e.message}`);
            return false;
        }
    }

    // =========================================================================
    // 辅助逻辑：路径、版本、XML解析
    // =========================================================================

    _getSelectedMode() {
        // 用户偏向：直接读取插件菜单的设置
        const value = (this._settings.get_string('color-mode') || '').toLowerCase();
        return value === 'light' ? 'light' : 'dark';
    }

    _getWallpaperPath(mode) {
        let uri = null;
        
        // 如果是暗黑模式，优先尝试读取 picture-uri-dark
        if (mode === 'dark') {
            uri = this._backgroundSettings.get_string('picture-uri-dark');
        }
        
        // 如果没有暗黑壁纸（uri为空），或者是浅色模式，读取 picture-uri
        if (!uri || uri === '') {
            uri = this._backgroundSettings.get_string('picture-uri');
        }

        if (!uri || uri === 'none') {
            return null;
        }

        try {
            const file = Gio.File.new_for_uri(uri);
            const path = file.get_path();
            
            if (!path) throw new Error('URI has no local path.');
            if (!GLib.file_test(path, GLib.FileTest.EXISTS)) throw new Error('File does not exist.');

            // 适配 XML 动态壁纸
            if (path.endsWith('.xml')) {
                console.log(`[Matugen] Detected XML wallpaper, extracting image from: ${path}`);
                return this._extractImageFromXml(path);
            }
            return path;
        } catch (error) {
            console.warn(`[Matugen] Invalid wallpaper URI (${uri}): ${error.message}`);
            return null;
        }
    }

    _extractImageFromXml(xmlPath) {
        try {
            const [success, content] = GLib.file_get_contents(xmlPath);
            if (!success) return xmlPath;

            const decoder = new TextDecoder('utf-8');
            const text = decoder.decode(content);

            // 正则：匹配 <filename> 或 <file> 标签中的内容
            // 动态壁纸 XML 通常包含多个文件，我们默认抓取第一个遇到的文件
            const match = text.match(/<(?:filename|file)>(.*?)<\/(?:filename|file)>/);
            
            if (match && match[1]) {
                let extractedPath = match[1].trim();
                
                // 处理 XML 内部的相对路径
                if (!extractedPath.startsWith('/')) {
                    const parentDir = GLib.path_get_dirname(xmlPath);
                    extractedPath = GLib.build_filenamev([parentDir, extractedPath]);
                }
                
                // 简单验证一下提取的文件是否存在
                if (GLib.file_test(extractedPath, GLib.FileTest.EXISTS)) {
                    return extractedPath;
                }
            }
        } catch (e) {
            console.warn(`[Matugen] Failed to parse XML wallpaper: ${e.message}`);
        }
        // 如果解析失败，返回原 XML 路径，虽然 Matugen 大概率会报错，但这是最后的尝试
        return xmlPath; 
    }

    async _ensureCompatibleImage(sourcePath) {
        const lowerPath = sourcePath.toLowerCase();
        
        if (!lowerPath.endsWith('.jxl')) {
            return sourcePath;
        }

        console.log(`[Matugen] Detected JXL image, converting to PNG: ${sourcePath}`);

        // 生成临时文件路径 /tmp/matugen-temp-wallpaper.png
        const tempDir = GLib.get_tmp_dir();
        const destPath = GLib.build_filenamev([tempDir, 'matugen-temp-wallpaper.png']);

        if (GLib.find_program_in_path('djxl')) {
            try {
                console.log('[Matugen] Converting with djxl...');
                await this._convertImageViaCLI('djxl', [sourcePath, destPath]);
                return destPath;
            } catch (e) {
                console.warn(`[Matugen] djxl failed: ${e.message}`);
            }
        }else {
            this._notifyError('Conversion Tool Missing', 'djxl not found in PATH. Please install djxl to handle JXL images.');
            return sourcePath;
        }
    }

    async _convertImageViaCLI(command, args) {
        const argv = [command, ...args];
        const subprocess = new Gio.Subprocess({
            argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        
        subprocess.init(null);
        
        const result = await subprocess.communicate_utf8_async(null, null);
        const exitStatus = subprocess.get_exit_status();
        
        if (exitStatus !== 0) {
            // 提取错误信息
            let stderr = '';
            if (Array.isArray(result)) {
                stderr = result.length === 3 ? result[2] : result[1];
            }
            throw new Error(`${command} exited with ${exitStatus}: ${stderr}`);
        }
    }

    // ... (Matugen 执行逻辑保持不变)
    async _runMatugen(wallpaperPath, mode) {
        const matugenPath = this._settings.get_string('matugen-path');
        const typeSetting = (this._settings.get_string('matugen-flavor') || '').trim();
        const configSetting = (this._settings.get_string('matugen-config') || '').trim();

        const argv = [matugenPath, 'image', wallpaperPath, '--mode', mode];

        const normalizedType = this._normalizeMatugenType(typeSetting);
        if (normalizedType) {
            argv.push('-t', normalizedType);
        }

        let configPath = this._expandPath(configSetting);
        if (!configPath) {
            // 如果未指定配置，且默认配置存在，则使用默认配置
            if (this._defaultMatugenConfig && GLib.file_test(this._defaultMatugenConfig, GLib.FileTest.EXISTS)) {
                configPath = this._defaultMatugenConfig;
            }
        }

        if (configPath) {
            argv.push('-c', configPath);
        }

        const { stdout } = await this._runProcess(argv);
        if (stdout.trim().length > 0) {
            console.log(`[Matugen] output: ${stdout.trim()}`);
        }
    }

    async _runProcess(argv) {
        const subprocess = new Gio.Subprocess({
            argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        subprocess.init(null);
        const result = await subprocess.communicate_utf8_async(null, null);
        
        // GJS 版本兼容性处理
        let stdout, stderr;
        if (Array.isArray(result)) {
            // 旧版 GJS 可能返回三个参数
            if (result.length === 3) [, stdout, stderr] = result;
            else [stdout, stderr] = result;
        } else {
            stdout = result;
        }

        const exitStatus = subprocess.get_exit_status();
        if (exitStatus !== 0) {
            const errText = stderr ? stderr.trim() : `Exit code ${exitStatus}`;
            throw new Error(errText);
        }
        return { stdout: stdout || '', stderr: stderr || '' };
    }

    async _getMatugenVersion(path) {
        try {
            const { stdout } = await this._runProcess([path, '--version']);
            // 匹配 "matugen 3.0.0" 中的 "3.0.0"
            const match = stdout.match(/(\d+\.\d+\.\d+)/);
            return match ? match[1] : null;
        } catch (e) {
            console.warn(`[Matugen] Check version failed: ${e.message}`);
            return null;
        }
    }

    _compareVersions(v1, v2) {
        const v1Parts = v1.split('.').map(Number);
        const v2Parts = v2.split('.').map(Number);
        for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
            const val1 = v1Parts[i] || 0;
            const val2 = v2Parts[i] || 0;
            if (val1 > val2) return 1;
            if (val1 < val2) return -1;
        }
        return 0;
    }

    // 规范化类型参数 (e.g. "scheme_tonal_spot" -> "scheme-tonal-spot")
    _normalizeMatugenType(value) {
        if (!value) return null;
        let normalized = value.trim();
        if (normalized.length === 0) return null;
        
        normalized = normalized.replace(/_/g, '-');
        if (!normalized.startsWith('scheme-')) {
            normalized = `scheme-${normalized}`;
        }
        return normalized;
    }

    _expandPath(path) {
        if (!path) return null;
        if (path === '~') return GLib.get_home_dir();
        if (path.startsWith('~/')) {
            return GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);
        }
        return path;
    }

    _applyInterfaceMode(mode) {
        let gtkTheme = `adw-gtk3-${mode}`;
        if (mode === 'light') {
            gtkTheme = 'adw-gtk3';
        }
        
        const colorScheme = `prefer-${mode}`;
        // 计算相反的 scheme 用于强制刷新
        const oppositeScheme = mode === 'dark' ? 'prefer-light' : 'prefer-dark';

        try {
            // 设置 GTK 主题
            const currentTheme = this._interfaceSettings.get_string('gtk-theme');
            if (currentTheme !== gtkTheme) {
                this._interfaceSettings.set_string('gtk-theme', gtkTheme);
            }

            // 强制刷新 color-scheme
            this._interfaceSettings.set_string('color-scheme', oppositeScheme);
            this._interfaceSettings.set_string('color-scheme', colorScheme);
            
        } catch (error) {
            console.error(`[Matugen Auto-Themer] Failed to apply interface settings: ${error}`);
        }
    }

    _notifyError(title, body) {
        // 使用 Main.notify 发送系统通知
        Main.notify(title, body);
        console.error(`[Matugen Auto-Themer] ${title}: ${body}`);
    }

    // =========================================================================
    // UI: 面板与菜单
    // =========================================================================

    _getIconPath(iconName) {
        let iconDir = GLib.build_filenamev([this.path, 'icons']);
        return GLib.build_filenamev([iconDir, `${iconName}-symbolic.svg`]);
    }

    _createPanelButton() {
        if (this._panelButton) return;

        this._panelButton = new PanelMenu.Button(0.0, this.metadata.name, false);

        // 使用 Box 布局来放置两个图标
        let box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        
        // 1. 主图标 (Matugen Logo)
        const mainIconFile = Gio.File.new_for_path(this._getIconPath('matugen-palette'));
        const mainGIcon = new Gio.FileIcon({ file: mainIconFile });
        this._mainIcon = new St.Icon({
            gicon: mainGIcon,
            style_class: 'system-status-icon',
        });
        
        // 2. 模式指示图标 (太阳/月亮)
        this._modeIcon = new St.Icon({
            style_class: 'system-status-icon',
            style: 'margin-left: 6px;' // 增加一点间距
        });

        box.add_child(this._mainIcon);
        box.add_child(this._modeIcon);

        this._panelButton.add_child(box);

        this._buildPanelMenu();
        Main.panel.addToStatusArea(this.metadata.uuid, this._panelButton);
    }

    _updatePanelIconState() {
        if (!this._modeIcon) return;

        const mode = this._getSelectedMode(); 
        const iconName = mode === 'light' ? 'mode-light' : 'mode-dark';
        
        const modeIconFile = Gio.File.new_for_path(this._getIconPath(iconName));
        const modeGIcon = new Gio.FileIcon({ file: modeIconFile });
        
        this._modeIcon.set_gicon(modeGIcon);
    }

    _buildPanelMenu() {
        if (!this._panelButton) return;

        const menu = this._panelButton.menu;
        menu.removeAll();

        this._modeItems = new Map();
        this._flavorItems = new Map();

        // --- 颜色模式 (Color Mode) ---
        const modeLabel = new PopupMenu.PopupMenuItem('Color mode', { reactive: false });
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

        // --- 配色方案 (Scheme Type) ---
        const flavorLabel = new PopupMenu.PopupMenuItem('Scheme type', { reactive: false });
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

        // --- 操作 ---
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
        // 1. 更新面板图标
        this._updatePanelIconState();

        // 2. 更新菜单勾选状态 (Color Mode)
        const currentMode = this._getSelectedMode();
        if (this._modeItems) {
            for (const [mode, item] of this._modeItems.entries()) {
                item.setOrnament(
                    mode === currentMode ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE
                );
            }
        }

        // 3. 更新菜单勾选状态 (Flavor)
        const currentFlavor = (this._settings?.get_string('matugen-flavor') || '').trim();
        if (this._flavorItems) {
            for (const [flavor, item] of this._flavorItems.entries()) {
                item.setOrnament(
                    flavor === currentFlavor ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE
                );
            }
        }
    }

    _formatFlavorLabel(flavor) {
        return flavor
            .replace(/^scheme-/, '')
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, letter => letter.toUpperCase());
    }
}