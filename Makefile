UUID     := lume@cjts15.github.io
SRC      := src
EXT_DIR  := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
ZIP      := $(UUID).shell-extension.zip

.PHONY: schemas pack install link unlink nested test smoke clean

# Needed for `make link`; `gnome-extensions install` compiles schemas itself.
schemas:
	glib-compile-schemas --strict $(SRC)/schemas

pack:
	gnome-extensions pack $(SRC) --force --out-dir=. \
		--extra-source=lib --extra-source=providers --extra-source=data

install: pack
	gnome-extensions install --force $(ZIP)

# Development install: symlink src/ so edits are picked up on the next
# Shell (or nested Shell) start.
link: schemas
	@if [ -e "$(EXT_DIR)" ] && [ ! -L "$(EXT_DIR)" ]; then \
		echo "$(EXT_DIR) exists and is not a symlink; remove it first"; exit 1; fi
	mkdir -p "$(dir $(EXT_DIR))"
	ln -sfn "$(CURDIR)/$(SRC)" "$(EXT_DIR)"

# Removes only the symlink, never the files it points to.
unlink:
	@if [ -L "$(EXT_DIR)" ]; then rm "$(EXT_DIR)"; \
	else echo "$(EXT_DIR) is not a symlink; nothing removed"; fi

# GNOME 49+ replaced --nested with --devkit (needs the mutter devkit viewer).
nested:
	@major=$$(gnome-shell --version | grep -oE '[0-9]+' | head -n1); \
	if [ "$$major" -ge 49 ]; then flag=--devkit; else flag=--nested; fi; \
	set -x; MUTTER_DEBUG_DUMMY_MODE_SPECS=1600x1000 dbus-run-session -- gnome-shell $$flag --wayland

test:
	@for t in tests/*.test.js; do gjs -m "$$t" || exit 1; done

# Headless gnome-shell in throwaway dirs: enable/disable cycles and prefs.
smoke: schemas
	tests/smoke.sh

clean:
	rm -f "$(ZIP)" "$(SRC)/schemas/gschemas.compiled"
