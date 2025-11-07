# Matugen Auto-Themer / Matugen 自动主题插件

## English

Matugen Auto-Themer is a GNOME Shell extension that watches wallpaper changes or manual mode switches (light/dark) and automatically runs [`matugen`](https://github.com/InioX/matugen). The extension:

- Picks the wallpaper path for the selected mode.
- Provides a panel menu button for quick access (switch light/dark mode, choose scheme, rerun Matugen, open preferences).
- Calls `matugen image … -t <scheme> -c <config>` using either your custom config or the bundled `matugen/config.toml`.
- Applies GNOME interface tweaks after generation by running:
  - `gsettings set org.gnome.desktop.interface gtk-theme adw-gtk3-<mode>` (light mode uses `adw-gtk3`).
  - `gsettings set org.gnome.desktop.interface color-scheme prefer-<mode>`.

Use the preferences dialog to set:

- Matugen executable path
- Optional config path (falls back to the bundled config)
- Scheme type (`scheme-*` values accepted by Matugen)
- Color mode (light or dark)

Before enabling, compile the schema:

```fish
glib-compile-schemas schemas
```

## 中文


插件会：

- 根据当前选择的模式获取壁纸路径。
- 在面板上提供快速按钮，可切换明/暗模式、选择方案、重新执行 Matugen 并打开首选项。
- 通过 `matugen image … -t <scheme> -c <config>` 运行 matugen，优先使用用户设置的配置文件，若无则使用内置的 `matugen/config.toml`。
- 在生成后执行以下命令以保持 GNOME 外观同步：
  - `gsettings set org.gnome.desktop.interface gtk-theme adw-gtk3-<mode>`（亮色模式使用 `adw-gtk3`）。
  - `gsettings set org.gnome.desktop.interface color-scheme prefer-<mode>`。

- matugen 可执行文件路径
- 可选的配置文件路径（未配置时使用内置配置）
- 颜色方案类型（`scheme-*` 格式的 matugen 类型）
- 明/暗模式

启用前请先编译 GSettings Schema：

```fish
glib-compile-schemas schemas
```

随后将插件目录复制或软链接到 `~/.local/share/gnome-shell/extensions/` 并重新载入 GNOME Shell。
