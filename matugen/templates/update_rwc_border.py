#!/usr/bin/env python3
import os
import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

# 1. 获取 Matugen 生成的颜色
r = {{colors.primary.default.red}} / 255.0
g = {{colors.primary.default.green}} / 255.0
b = {{colors.primary.default.blue}} / 255.0
a = 0.8  # 不透明度

# 2. 定义 Schema ID 和 Key
schema_id = "org.gnome.shell.extensions.rounded-window-corners-reborn"
key = "global-rounded-corner-settings"

# 3. 加载 Schema
schema_source = Gio.SettingsSchemaSource.get_default()
local_schema_path = os.path.expanduser("~/.local/share/gnome-shell/extensions/rounded-window-corners@fxgn/schemas/")

if schema_source.lookup(schema_id, True) is None and os.path.exists(local_schema_path):
    schema_source = Gio.SettingsSchemaSource.new_from_directory(local_schema_path, schema_source, False)

schema = schema_source.lookup(schema_id, True)
if not schema:
    print(f"错误: 找不到架构 {schema_id}，请确认插件已安装。")
    exit(1)

settings = Gio.Settings(settings_schema=schema)

# 4. 读取当前配置
current_val = settings.get_value(key)

# 5. 构建新的配置字典
# 使用 n_children() + get_child_value() 进行遍历
# 使用 add_value() 进行添加
builder = GLib.VariantBuilder(GLib.VariantType.new("a{sv}"))
count = current_val.n_children()

for i in range(count):
    # child 是一个 {sv} 类型的字典项 (key, value)
    child = current_val.get_child_value(i)
    k = child.get_child_value(0).get_string()
    
    if k == "borderColor":
        # 构造新的颜色值 Variant，类型为 (dddd)
        new_color_val = GLib.Variant("(dddd)", (r, g, b, a))
        
        # 构造新的字典条目 Variant，类型为 {sv}
        # 注意：{sv} 表示 key 是字符串，value 是 Variant。
        # 这里 new_color_val 本身就是一个 Variant，符合 v 的定义。
        new_entry = GLib.Variant("{sv}", (k, new_color_val))
        
        builder.add_value(new_entry)
    else:
        # 对于不需要修改的项，直接将原有的 child ({sv} Variant) 添加回去
        builder.add_value(child)

# 6. 应用新设置
new_val = builder.end()
settings.set_value(key, new_val)
print(f"Rounded Window Corners 边框颜色已更新为: ({r:.2f}, {g:.2f}, {b:.2f})")

