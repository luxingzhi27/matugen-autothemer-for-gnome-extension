#!/bin/bash

EXTENSION_UUID="matugen-autothemer@luxingzhi27"
INSTALL_PATH="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
THEME_PATH="$HOME/.local/share/themes/Material-You/gnome-shell/"

echo "Installing $EXTENSION_UUID..."

# Create theme directory if it doesn't exist
if [ ! -d "$THEME_PATH" ]; then
    echo "Creating theme directory: $THEME_PATH"
    mkdir -p "$THEME_PATH"
fi

# Remove existing extension installation
if [ -d "$INSTALL_PATH" ]; then
    echo "Removing old installation at $INSTALL_PATH..."
    rm -rf "$INSTALL_PATH"
fi

# Create extension directory
mkdir -p "$INSTALL_PATH"

# Copy files from current directory to install path
# We assume the script is run from the root of the extension source
SOURCE_DIR=$(dirname "$(realpath "$0")")

echo "Copying extension files..."
cp -r "$SOURCE_DIR"/* "$INSTALL_PATH/"

# Compile schemas
if command -v glib-compile-schemas >/dev/null 2>&1; then
    echo "Compiling GSettings schemas..."
    glib-compile-schemas "$INSTALL_PATH/schemas"
else
    echo "Warning: glib-compile-schemas not found. Schemas not compiled."
fi

echo "----------------------------------------------------------------"
echo "Installation successful!"
echo "Please restart GNOME Shell to enable the extension:"
echo "  - Wayland: Log out and log back in."
echo "  - X11: Press Alt+F2, type 'r', and press Enter."
echo "----------------------------------------------------------------"