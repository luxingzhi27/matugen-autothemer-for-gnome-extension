#!/usr/bin/env python3
import configparser
import os
import sys

# 1. 定义路径
# 这是 Matugen 生成的标准配色文件 (源)
source_file = os.path.expanduser("~/.local/share/color-schemes/MaterialYou.colors")
# 这是 KDE 的系统配置文件 (目标)
target_file = os.path.expanduser("~/.config/kdeglobals")

# 检查源文件是否存在
if not os.path.exists(source_file):
    print(f"Error: Source file {source_file} not found.")
    sys.exit(0) # 退出但不报错，以免中断流程

# 2. 初始化 ConfigParser
# optionxform = str 是为了保留键的大小写 (KDE 对大小写敏感)
source_conf = configparser.ConfigParser(interpolation=None)
source_conf.optionxform = str
source_conf.read(source_file)

target_conf = configparser.ConfigParser(interpolation=None)
target_conf.optionxform = str
target_conf.read(target_file)

# 3. 开始合并
print("Merging Matugen colors into kdeglobals...")

for section in source_conf.sections():
    # 主要关心 [Colors:...] 相关的部分
    # 以及 [General] 中的 ColorScheme 等特定键
    if not target_conf.has_section(section):
        target_conf.add_section(section)

    for key, value in source_conf.items(section):
        # 直接覆盖或添加 Key，保留该 Section 下原有的其他 Key
        target_conf.set(section, key, value)

# 4. 写入回 kdeglobals
with open(target_file, 'w') as f:
    target_conf.write(f, space_around_delimiters=False)

print("Success! kdeglobals updated safely.")