import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const FLAVORS = [
    'tonal-spot', 'vibrant', 'expressive', 'fruit-salad',
    'content', 'monochrome', 'neutral', 'rainbow', 'fidelity',
];

const MODES = ['dark', 'light'];

export default class MatugenPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(500, 400);

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'Matugen Configuration',
            description: 'Configure how the extension interacts with the Matugen binary.',
        });

        page.add(group);
        window.add(page);

        // --- 1. 可执行文件路径 ---
        const pathRow = new Adw.EntryRow({
            title: 'Matugen Executable Path',
            tooltip_text: 'Absolute path to the matugen binary',
        });
        settings.bind('matugen-path', pathRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(pathRow);

        // --- 2. 配置文件路径 ---
        const configRow = new Adw.EntryRow({
            title: 'Config File Path',
            tooltip_text: 'Optional path to a custom config.toml',
        });
        settings.bind('matugen-config', configRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(configRow);

        // --- 3. 颜色模式选择 (ComboRow) ---
        // 使用辅助函数创建下拉列表
        this._createComboRow(group, settings, 'Color Mode', 'color-mode', MODES);

        // --- 4. 配色方案选择 (ComboRow) ---
        this._createComboRow(group, settings, 'Scheme Type', 'matugen-flavor', FLAVORS);
    }

    /**
     * 辅助函数：创建并绑定 ComboRow
     * 自动处理 GSettings(String) 与 ComboRow(Index) 之间的映射
     */
    _createComboRow(group, settings, title, key, items) {
        const model = new Gtk.StringList();
        items.forEach(item => model.append(item));

        const row = new Adw.ComboRow({
            title: title,
            model: model,
        });

        // 初始值同步：Settings -> UI
        const syncUi = () => {
            const currentVal = settings.get_string(key);
            let idx = items.indexOf(currentVal);
            // 如果设置里的值不在列表中（比如手动修改过），添加进去或默认为0
            if (idx === -1) {
                if (currentVal) {
                    // 简单处理：如果找不到就选第一个，防止 UI 异常
                    idx = 0; 
                } else {
                    idx = 0;
                }
            }
            row.set_selected(idx);
        };

        syncUi();

        // 监听 UI 变化 -> 写回 Settings
        row.connect('notify::selected', () => {
            const idx = row.get_selected();
            if (idx >= 0 && idx < items.length) {
                settings.set_string(key, items[idx]);
            }
        });

        // 监听 Settings 变化 -> 更新 UI (处理外部修改)
        const id = settings.connect(`changed::${key}`, syncUi);

        // 确保销毁时断开信号
        group.connect('destroy', () => settings.disconnect(id));

        group.add(row);
    }
}