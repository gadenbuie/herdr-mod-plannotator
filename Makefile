# Render assets/preview.html to the repo-root preview.png:
# 1280×800 authored, 1.25× device scale, shipping at 1600×1000.
CHROME ?= /Applications/Google Chrome.app/Contents/MacOS/Google Chrome

.PHONY: preview
preview: preview.png

preview.png: assets/preview.html
	@test -x "$(CHROME)" || { echo "make: no Chrome at $(CHROME) (set CHROME=... to override)"; exit 1; }
	"$(CHROME)" \
	  --headless \
	  --screenshot=preview.png \
	  --window-size=1280,800 \
	  --force-device-scale-factor=1.25 \
	  --hide-scrollbars \
	  "file://$(CURDIR)/assets/preview.html" 2>/dev/null
	@sips -g pixelWidth -g pixelHeight preview.png | tail -2

.PHONY: install
install:
	./install.sh
