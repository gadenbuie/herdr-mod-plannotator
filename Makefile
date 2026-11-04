# Render assets/preview.html to the repo-root preview.png:
# 1280×800 authored, 1.25× device scale, shipping at 1600×1000.
CHROME ?= /Applications/Google Chrome.app/Contents/MacOS/Google Chrome

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help.
	@fgrep -h "##" $(MAKEFILE_LIST) | fgrep -v fgrep | sed -e 's/\\$$//' | sed -e 's/##//'

.PHONY: preview
preview: preview.png ## Render assets/preview.html to preview.png (1600×1000).

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
install: ## Run ./install.sh — copy the mod into Herdr, wire it, and check it.
	./install.sh
