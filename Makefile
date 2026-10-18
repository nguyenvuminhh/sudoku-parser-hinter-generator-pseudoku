.PHONY: dev fe test build serve test-browser

dev: fe

fe:
	cd frontend && npm run dev -- --hostname 127.0.0.1 --port 3000

test:
	cd frontend && npm test -- --run
	cd frontend && npm run typecheck

build:
	cd frontend && npm run build

serve:
	cd frontend && node scripts/serve-static.mjs

test-browser:
	cd frontend && npm run test:browser
