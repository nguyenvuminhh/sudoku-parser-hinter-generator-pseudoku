.PHONY: be fe test build dev model engine

be:
	python3 -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001 --reload

fe:
	cd frontend && npm run dev -- --hostname 127.0.0.1 --port 3000

test:
	python3 -m unittest discover -s tests -v
	cd frontend && npm test -- --run
	cd frontend && npm run typecheck

build:
	cd frontend && npm run build

model:
	python3 -m pip install -r requirements-model.txt
	python3 scripts/download_digit_model.py

engine:
	cd tools/sudoku-engine-cli && cargo build --release
	mkdir -p bin
	cp tools/sudoku-engine-cli/target/release/puzzle-hint-sudoku-engine bin/sudoku-engine

dev:
	@echo "Run make fe for the browser app; make be is optional for standalone API development."
