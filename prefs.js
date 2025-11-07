import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const FLAVORS = [
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

const MODES = [
    'dark',
    'light',
];

export default class MatugenPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.set_default_size(480, 360);

        const generalPage = new Adw.PreferencesPage();
        window.add(generalPage);

        const integrationGroup = new Adw.PreferencesGroup({
            title: 'Matugen Command',
            description: 'Configure the executable, type, and optional config passed to matugen.',
        });
        generalPage.add(integrationGroup);

        const pathRow = new Adw.EntryRow({
            title: 'Matugen executable path',
        });
        settings.bind('matugen-path', pathRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        integrationGroup.add(pathRow);

        const configRow = new Adw.EntryRow({
            title: 'Matugen config path',
        });
        settings.bind('matugen-config', configRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        integrationGroup.add(configRow);

        const modeList = new Gtk.StringList();
        for (const mode of MODES) {
            modeList.append(mode);
        }
        const modeRow = new Adw.ComboRow({
            title: 'Color mode',
            subtitle: 'Run matugen in the selected light or dark mode.',
            model: modeList,
        });
        const initialMode = settings.get_string('color-mode');
        modeRow.set_selected(Math.max(0, MODES.indexOf(initialMode)));
        modeRow.connect('notify::selected', row => {
            const index = row.get_selected();
            if (index >= 0 && index < MODES.length) {
                settings.set_string('color-mode', MODES[index]);
            }
        });
        const modeSignalId = settings.connect('changed::color-mode', () => {
            const value = settings.get_string('color-mode');
            const idx = MODES.indexOf(value);
            if (idx >= 0) {
                modeRow.set_selected(idx);
            }
        });
        integrationGroup.add(modeRow);

        const flavorList = new Gtk.StringList();
        for (const flavor of FLAVORS) {
            flavorList.append(flavor);
        }
        const currentFlavor = settings.get_string('matugen-flavor');
        let flavorIndex = FLAVORS.indexOf(currentFlavor);
        if (flavorIndex === -1 && currentFlavor.length > 0) {
            flavorList.append(currentFlavor);
            flavorIndex = flavorList.get_n_items() - 1;
        }
        if (flavorIndex < 0) {
            flavorIndex = 0;
        }

        const flavorRow = new Adw.ComboRow({
            title: 'Scheme type',
            subtitle: 'Value supplied to matugen --type.',
            model: flavorList,
            selected: flavorIndex,
        });
        flavorRow.connect('notify::selected', row => {
            const index = row.get_selected();
            if (index < 0) {
                return;
            }
            const value = flavorList.get_string(index);
            settings.set_string('matugen-flavor', value);
        });
        const flavorSignalId = settings.connect('changed::matugen-flavor', () => {
            const updated = settings.get_string('matugen-flavor');
            let idx = -1;
            for (let i = 0; i < flavorList.get_n_items(); i++) {
                if (flavorList.get_string(i) === updated) {
                    idx = i;
                    break;
                }
            }
            if (idx === -1 && updated.length > 0) {
                flavorList.append(updated);
                idx = flavorList.get_n_items() - 1;
            }
            if (idx >= 0) {
                flavorRow.set_selected(idx);
            }
        });
        window.connect('destroy', () => {
            settings.disconnect(flavorSignalId);
            settings.disconnect(modeSignalId);
        });
        integrationGroup.add(flavorRow);
    }
}
