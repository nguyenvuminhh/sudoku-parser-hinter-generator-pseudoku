import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PublicReleaseFilesTests(unittest.TestCase):
    def test_public_release_files_exist(self):
        required_paths = [
            "LICENSE",
            ".gitignore",
            ".dockerignore",
            "Dockerfile",
            "frontend/.env.example",
            ".github/workflows/ci.yml",
            ".github/workflows/frontend-pages.yml",
            ".github/workflows/supabase-migrations.yml",
            "THIRD_PARTY_NOTICES.md",
            "tools/sudoku-engine-cli/Cargo.toml",
        ]

        for relative_path in required_paths:
            with self.subTest(path=relative_path):
                self.assertTrue((ROOT / relative_path).exists())

    def test_backend_dockerfile_runs_fastapi_api_with_healthcheck(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

        self.assertIn("FROM python:", dockerfile)
        self.assertIn("requirements.txt", dockerfile)
        self.assertIn("requirements-model.txt", dockerfile)
        self.assertIn("FROM rust:", dockerfile)
        self.assertIn("tools/sudoku-engine-cli", dockerfile)
        self.assertIn("SUDOKU_ENGINE_BIN=/app/bin/sudoku-engine", dockerfile)
        self.assertIn("COPY --from=sudoku_engine_builder", dockerfile)
        self.assertIn("scripts/download_digit_model.py", dockerfile)
        self.assertNotIn("ARG INSTALL_MODEL", dockerfile)
        self.assertNotIn("ARG DOWNLOAD_MODEL", dockerfile)
        self.assertIn("EXPOSE 8001", dockerfile)
        self.assertIn("HEALTHCHECK", dockerfile)
        self.assertIn("uvicorn backend.app.main:app", dockerfile)

    def test_backend_docker_image_includes_serate_bucket_corpus(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        dockerignore = (ROOT / ".dockerignore").read_text(encoding="utf-8")

        self.assertIn("COPY data/puzzles/serate-buckets ./data/puzzles/serate-buckets", dockerfile)
        self.assertIn("!data/puzzles/serate-buckets/**", dockerignore)
        self.assertTrue((ROOT / "data" / "puzzles" / "serate-buckets" / "manifest.json").exists())

    def test_ci_builds_sudoku_engine_cli(self):
        workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")

        self.assertIn("actions-rust-lang/setup-rust-toolchain", workflow)
        self.assertIn("cargo build --manifest-path tools/sudoku-engine-cli/Cargo.toml --release", workflow)

    def test_sudoku_engine_cli_pins_ukodus_source(self):
        cargo_toml = (ROOT / "tools" / "sudoku-engine-cli" / "Cargo.toml").read_text(encoding="utf-8")

        self.assertIn("sudoku-core", cargo_toml)
        self.assertIn("https://github.com/kcirtapfromspace/sudoku-core", cargo_toml)
        self.assertIn("ad8f024d507a52eff99fdd8b5173763487b30a31", cargo_toml)
        self.assertIn("MIT", cargo_toml)

    def test_third_party_notices_cover_runtime_dependencies_and_model(self):
        notice = (ROOT / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")

        required_strings = [
            "FastAPI",
            "Starlette",
            "Uvicorn",
            "OpenCV",
            "NumPy",
            "onnxruntime",
            "Hugging Face Hub",
            "onnxmodelzoo/mnist-8",
            "https://huggingface.co/onnxmodelzoo/mnist-8",
            "Apache-2.0",
            "Next.js",
            "React",
            "React DOM",
            "lucide-react",
            "caniuse-lite",
            "CC-BY-4.0",
            "lightningcss",
            "MPL-2.0",
            "sharp",
            "libvips",
            "LGPL-3.0-or-later",
            "Ukodus sudoku-core",
            "l2sg",
            "https://github.com/rafaelfassi/l2sg",
            "legal advice",
        ]

        for text in required_strings:
            with self.subTest(text=text):
                self.assertIn(text, notice)

    def test_public_release_files_do_not_ship_generic_ocr_fallback(self):
        checked_files = [
            ROOT / "Dockerfile",
            ROOT / "requirements.txt",
            ROOT / "THIRD_PARTY_NOTICES.md",
            ROOT / "backend" / "app" / "ocr.py",
            ROOT / "README.md",
            ROOT / "AGENTS.md",
        ]

        forbidden_strings = [
            "tesseract",
            "pytesseract",
            "generic OCR fallback",
            "generic ocr fallback",
            "Pillow",
            "from PIL",
        ]

        for path in checked_files:
            content = path.read_text(encoding="utf-8")
            for text in forbidden_strings:
                with self.subTest(path=path.relative_to(ROOT), text=text):
                    self.assertNotIn(text, content)

    def test_readme_links_to_third_party_notices(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn("Third-party notices", readme)
        self.assertIn("THIRD_PARTY_NOTICES.md", readme)

    def test_requirements_include_fastapi_testclient_transport(self):
        requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")

        self.assertRegex(requirements, r"(?m)^httpx[<>=]")

    def test_frontend_pages_workflow_builds_static_export(self):
        workflow = (ROOT / ".github" / "workflows" / "frontend-pages.yml").read_text(encoding="utf-8")

        self.assertIn("actions/upload-pages-artifact", workflow)
        self.assertIn("actions/deploy-pages", workflow)
        self.assertIn("path: frontend/out", workflow)
        self.assertIn("NEXT_PUBLIC_SUPABASE_URL", workflow)
        self.assertIn("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", workflow)
        self.assertIn("SUPABASE_ACCESS_TOKEN", workflow)
        self.assertIn("SUPABASE_PROJECT_ID", workflow)
        self.assertIn("api.supabase.com/v1/projects", workflow)
        self.assertIn("GITHUB_ENV", workflow)

    def test_supabase_migration_workflow_deploys_checked_in_migrations(self):
        workflow = (ROOT / ".github" / "workflows" / "supabase-migrations.yml").read_text(encoding="utf-8")
        readme = (ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn("Deploy Supabase Migrations", workflow)
        self.assertIn("branches: [main]", workflow)
        self.assertIn("supabase/migrations/**", workflow)
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("concurrency:", workflow)
        self.assertIn("supabase/setup-cli@v2", workflow)
        self.assertIn("SUPABASE_ACCESS_TOKEN", workflow)
        self.assertIn("SUPABASE_PROJECT_ID", workflow)
        self.assertIn("SUPABASE_DB_PASSWORD", workflow)
        self.assertIn("supabase link --project-ref", workflow)
        self.assertIn("supabase db push --linked", workflow)
        self.assertIn("--yes", workflow)

        self.assertIn("Supabase migration deployment", readme)
        self.assertIn("SUPABASE_ACCESS_TOKEN", readme)
        self.assertIn("SUPABASE_PROJECT_ID", readme)
        self.assertIn("SUPABASE_DB_PASSWORD", readme)

    def test_supabase_workflow_configures_auth_redirect_urls(self):
        workflow = (ROOT / ".github" / "workflows" / "supabase-migrations.yml").read_text(encoding="utf-8")
        readme = (ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn("/config/auth", workflow)
        self.assertIn("site_url", workflow)
        self.assertIn("uri_allow_list", workflow)
        self.assertIn("SUPABASE_AUTH_SITE_URL", workflow)
        self.assertIn("NEXT_PUBLIC_BASE_PATH", workflow)
        self.assertIn("http://localhost:3000/**", workflow)
        self.assertIn("http://127.0.0.1:3000/**", workflow)

        self.assertIn("Supabase Auth URL configuration", readme)
        self.assertIn("SUPABASE_AUTH_SITE_URL", readme)
        self.assertIn("redirect allow-list", readme)

    def test_next_config_supports_optional_github_pages_base_path(self):
        next_config = (ROOT / "frontend" / "next.config.ts").read_text(encoding="utf-8")

        self.assertIn("NEXT_PUBLIC_BASE_PATH", next_config)
        self.assertIn("basePath", next_config)
        self.assertIn("assetPrefix", next_config)

    def test_readme_documents_split_ec2_and_github_pages_deployment(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn("EC2", readme)
        self.assertIn("GitHub Pages", readme)
        self.assertIn("NEXT_PUBLIC_API_BASE_URL", readme)


if __name__ == "__main__":
    unittest.main()
