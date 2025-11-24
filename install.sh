# /bin/bash

if [ -d ~/.local/share/gnome-shell/extensions/matugen-autothemer@luxingzhi27 ]; then
    rm -rf ~/.local/share/gnome-shell/extensions/matugen-autothemer@luxingzhi27
fi

mkdir -p ~/.local/share/themes/Material-You/gnome-shell/

echo "Cloning matugen-autothemer extension repository..."

git clone https://github.com/luxingzhi27/matugen-autothemer.git ~/.local/share/gnome-shell/extensions/matugen-autothemer@luxingzhi27

cd ~/.local/share/gnome-shell/extensions/matugen-autothemer@luxingzhi27

echo "Compiling GSettings schemas..."
glib-compile-schemas schemas

echo "matugen-autothemer@luxingzhi27 installed successfully."
echo "Please restart GNOME Shell (Alt+F2, then type 'r' and press Enter) or log out and log back in to activate the extension."