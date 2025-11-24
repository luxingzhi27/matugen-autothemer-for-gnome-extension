# /bin/bash
rm -rf ~/.local/share/gnome-shell/extensions/matugen-autothemer@luxingzhi27
glib-compile-schemas schemas
mkdir -p ~/.local/share/gnome-shell/extensions/matugen-autothemer@luxingzhi27/
cp -r ./extension.js prefs.js metadata.json schemas/ matugen/ icons/ ~/.local/share/gnome-shell/extensions/matugen-autothemer@luxingzhi27/