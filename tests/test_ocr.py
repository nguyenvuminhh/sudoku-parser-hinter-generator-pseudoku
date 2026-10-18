import unittest
from unittest.mock import patch

from backend.app.ocr import (
    OnnxDigitClassifier,
    TemplateDigitClassifier,
    _prepare_cell_ink,
    _normalize_digit_image,
    default_digit_model_path,
    extract_sudoku_cells,
    load_digit_classifier,
    recognize_sudoku_image,
)


class OcrTests(unittest.TestCase):
    def setUp(self):
        if hasattr(load_digit_classifier, "cache_clear"):
            load_digit_classifier.cache_clear()

    def test_recognize_sudoku_image_returns_editable_grid_shape(self):
        result = recognize_sudoku_image(b"not-a-real-image", "bad-upload.txt")

        self.assertEqual(len(result.cells), 81)
        self.assertTrue(all(0 <= cell.confidence <= 1 for cell in result.cells))
        self.assertTrue(all(cell.value is None or 1 <= cell.value <= 9 for cell in result.cells))
        self.assertGreaterEqual(len(result.warnings), 1)

    def test_failed_opencv_import_returns_empty_cells_without_secondary_ocr_path(self):
        with patch("backend.app.ocr.extract_sudoku_cells", side_effect=ValueError("no grid")):
            result = recognize_sudoku_image(b"not-a-real-image", "bad-upload.txt")

        self.assertEqual(len(result.cells), 81)
        self.assertTrue(all(cell.value is None for cell in result.cells))
        warning_text = " ".join(result.warnings).lower()
        self.assertNotIn("fallback", warning_text)
        self.assertIn("could not find a sudoku grid", warning_text)

    def test_extract_sudoku_cells_finds_positions_from_grid_image(self):
        image_bytes = make_synthetic_sudoku_image({(1, 1): 5, (5, 5): 9, (9, 9): 2})

        cells = extract_sudoku_cells(image_bytes)

        self.assertEqual(len(cells), 81)
        self.assertEqual(cells[0].row, 1)
        self.assertEqual(cells[0].col, 1)
        self.assertEqual(cells[40].row, 5)
        self.assertEqual(cells[40].col, 5)
        self.assertEqual(cells[80].row, 9)
        self.assertEqual(cells[80].col, 9)
        self.assertTrue(cells[0].has_ink)

    def test_template_digit_classifier_recognizes_isolated_digit(self):
        image_bytes = make_synthetic_sudoku_image({(1, 1): 7})
        cell = extract_sudoku_cells(image_bytes)[0]

        prediction = TemplateDigitClassifier().predict(cell.image)

        self.assertEqual(prediction.value, 7)
        self.assertGreater(prediction.confidence, 0.5)

    def test_pencil_notes_are_ignored_as_blank_cells(self):
        image_bytes = make_synthetic_sudoku_image({}, notes={(1, 1): [1, 2, 6, 9]})
        cell = extract_sudoku_cells(image_bytes)[0]

        prediction = TemplateDigitClassifier().predict(cell.image)

        self.assertFalse(cell.has_ink)
        self.assertIsNone(prediction.value)

    def test_large_digit_with_separate_notes_is_skipped(self):
        import numpy as np

        image = np.full((100, 100), 255, dtype=np.uint8)
        image[25:80, 30:80] = 0
        image[5:10, 5:10] = 0
        normalized, ink_ratio = _normalize_digit_image(image)
        self.assertEqual(ink_ratio, 0)
        self.assertIsNone(TemplateDigitClassifier().predict(normalized).value)

    def test_narrow_full_height_digit_is_accepted_by_size_rule(self):
        image_bytes = make_synthetic_sudoku_image({(1, 1): 1})
        self.assertTrue(extract_sudoku_cells(image_bytes)[0].has_ink)

    def test_cell_preprocessing_thresholds_without_resizing_and_normalizes_both_polarities(self):
        import cv2
        import numpy as np

        masks = []
        for background, foreground in ((245, 30), (30, 245), (100, 150)):
            image = np.full((50, 50), background, dtype=np.uint8)
            cv2.putText(image, "1", (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, foreground, 2)
            binary = _prepare_cell_ink(image)
            self.assertEqual(binary.shape, image.shape)
            self.assertEqual(set(np.unique(binary)), {0, 255})
            self.assertEqual(int(binary[0, 0]), 0)
            masks.append(binary)
        for mask in masks[1:]:
            np.testing.assert_array_equal(mask, masks[0])

    def test_uniform_backgrounds_stay_blank(self):
        import numpy as np

        for color in (0, 40, 128, 220, 255):
            with self.subTest(color=color):
                normalized, ink_ratio = _normalize_digit_image(np.full((50, 50), color, np.uint8))
                self.assertEqual(ink_ratio, 0)
                self.assertFalse(np.any(normalized))

    def test_color_cell_and_its_grayscale_version_have_same_ink(self):
        import cv2
        import numpy as np

        image = np.full((50, 50, 3), (170, 80, 35), dtype=np.uint8)
        cv2.putText(image, "8", (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 2)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        np.testing.assert_array_equal(_prepare_cell_ink(image), _prepare_cell_ink(gray))

    def test_light_digit_on_dark_cell_matches_dark_digit_on_light_cell(self):
        import cv2
        import numpy as np

        image = np.full((50, 50), 240, dtype=np.uint8)
        cv2.putText(image, "6", (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, 20, 2)
        normal, normal_ratio = _normalize_digit_image(image)
        inverted, inverted_ratio = _normalize_digit_image(255 - image)
        self.assertGreater(normal_ratio, 0)
        self.assertEqual(normal_ratio, inverted_ratio)
        np.testing.assert_array_equal(normal, inverted)

    def test_cluster_filter_rejects_empty_small_and_multiple_clusters(self):
        import numpy as np

        for rectangles in ([], [(30, 20, 79, 69)], [(5, 20, 30, 80), (60, 20, 90, 80)]):
            with self.subTest(rectangles=rectangles):
                image = np.full((100, 100), 255, dtype=np.uint8)
                for x1, y1, x2, y2 in rectangles:
                    image[y1:y2, x1:x2] = 0
                normalized, ink_ratio = _normalize_digit_image(image)
                self.assertEqual(ink_ratio, 0)
                self.assertFalse(np.any(normalized))

    def test_cluster_size_cutoff_includes_exactly_half_cell_width(self):
        import numpy as np

        for width, height in ((10, 50), (50, 10)):
            with self.subTest(width=width, height=height):
                image = np.full((100, 100), 255, dtype=np.uint8)
                image[20:20 + height, 25:25 + width] = 0
                normalized, ink_ratio = _normalize_digit_image(image)
                self.assertGreater(ink_ratio, 0)
                self.assertEqual(normalized.shape, (28, 28))

    def test_cluster_distance_uses_original_cell_width_and_preserves_gaps(self):
        import numpy as np

        for distance, accepted in ((7, True), (8, False)):
            with self.subTest(distance=distance):
                image = np.full((80, 80), 255, dtype=np.uint8)
                image[20:60, 5:30] = 0
                image[20:60, 29 + distance:65] = 0
                normalized, ink_ratio = _normalize_digit_image(image, cell_width=100)
                self.assertEqual(ink_ratio > 0, accepted)
                if accepted:
                    self.assertEqual(int(normalized[14, 13]), 0)

    def test_cluster_merging_is_transitive(self):
        import numpy as np

        image = np.full((100, 100), 255, dtype=np.uint8)
        image[20:80, 10:25] = 0
        image[20:80, 31:46] = 0
        image[20:80, 52:67] = 0
        _, ink_ratio = _normalize_digit_image(image)
        self.assertGreater(ink_ratio, 0)

    def test_cluster_distance_is_euclidean(self):
        import numpy as np

        image = np.full((100, 100), 255, dtype=np.uint8)
        image[5:40, 5:40] = 0
        image[44:85, 44:85] = 0
        # Nearest pixels differ by (5, 5): farther than the 7px radius.
        _, ink_ratio = _normalize_digit_image(image)
        self.assertEqual(ink_ratio, 0)

    def test_rejected_cells_do_not_reach_classifier(self):
        image_bytes = make_synthetic_sudoku_image({}, notes={(1, 1): [1, 2, 6, 9]})
        with patch("backend.app.ocr.load_digit_classifier") as load:
            result = recognize_sudoku_image(image_bytes, "notes.png")
        load.return_value.predict.assert_not_called()
        self.assertTrue(all(cell.value is None for cell in result.cells))

    def test_load_digit_classifier_prefers_downloaded_default_model(self):
        with (
            patch("backend.app.ocr.Path.exists", return_value=True),
            patch("backend.app.ocr.OnnxDigitClassifier") as classifier,
            patch.dict("os.environ", {}, clear=True),
        ):
            load_digit_classifier()

        classifier.assert_called_once_with(default_digit_model_path())

    def test_load_digit_classifier_uses_env_model_path(self):
        with (
            patch("backend.app.ocr.OnnxDigitClassifier") as classifier,
            patch.dict("os.environ", {"SUDOKU_DIGIT_MODEL": "/tmp/model.onnx"}, clear=True),
        ):
            load_digit_classifier()

        classifier.assert_called_once_with("/tmp/model.onnx")

    def test_load_digit_classifier_reuses_classifier_instance(self):
        with (
            patch("backend.app.ocr.Path.exists", return_value=True),
            patch("backend.app.ocr.OnnxDigitClassifier", side_effect=[object(), object()]) as classifier,
            patch.dict("os.environ", {}, clear=True),
        ):
            first = load_digit_classifier()
            second = load_digit_classifier()

        self.assertIs(first, second)
        classifier.assert_called_once_with(default_digit_model_path())

    def test_onnx_classifier_can_use_probability_like_model(self):
        class FakeTensor:
            name = "image"
            shape = [None, 1, 28, 28]

        class FakeSession:
            def get_inputs(self):
                return [FakeTensor()]

            def get_outputs(self):
                return [FakeTensor()]

            def run(self, output_names, inputs):
                self.inputs = inputs
                return [[[0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.91, 0.01, 0.01]]]

        image_bytes = make_synthetic_sudoku_image({(1, 1): 7})
        cell = extract_sudoku_cells(image_bytes)[0]
        classifier = OnnxDigitClassifier.from_session(FakeSession())

        prediction = classifier.predict(cell.image)

        self.assertEqual(prediction.value, 7)
        self.assertGreater(prediction.confidence, 0.9)

    def test_onnx_classifier_uses_closed_loop_to_disambiguate_five_from_six(self):
        class FakeTensor:
            name = "image"
            shape = [None, 1, 28, 28]

        class FiveBiasedSession:
            def get_inputs(self):
                return [FakeTensor()]

            def get_outputs(self):
                return [FakeTensor()]

            def run(self, output_names, inputs):
                return [[[0.01, 0.01, 0.01, 0.01, 0.01, 0.86, 0.06, 0.01, 0.01, 0.01]]]

        image_bytes = make_synthetic_sudoku_image({(1, 1): 6})
        cell = extract_sudoku_cells(image_bytes)[0]
        classifier = OnnxDigitClassifier.from_session(FiveBiasedSession())

        prediction = classifier.predict(cell.image)

        self.assertEqual(prediction.value, 6)


if __name__ == "__main__":
    unittest.main()


def make_synthetic_sudoku_image(
    digits: dict[tuple[int, int], int],
    notes: dict[tuple[int, int], list[int]] | None = None,
) -> bytes:
    import cv2
    import numpy as np

    size = 450
    cell = size // 9
    image = np.full((size, size), 255, dtype=np.uint8)

    for line in range(10):
        thickness = 4 if line % 3 == 0 else 1
        offset = line * cell
        cv2.line(image, (offset, 0), (offset, size), 0, thickness)
        cv2.line(image, (0, offset), (size, offset), 0, thickness)

    for (row, col), digit in digits.items():
        text = str(digit)
        font = cv2.FONT_HERSHEY_SIMPLEX
        scale = 1.5
        thickness = 3
        text_size, _ = cv2.getTextSize(text, font, scale, thickness)
        x = (col - 1) * cell + (cell - text_size[0]) // 2
        y = (row - 1) * cell + (cell + text_size[1]) // 2
        cv2.putText(image, text, (x, y), font, scale, 0, thickness, cv2.LINE_AA)

    note_slots = [
        (0.18, 0.24),
        (0.46, 0.24),
        (0.74, 0.24),
        (0.18, 0.52),
        (0.46, 0.52),
        (0.74, 0.52),
        (0.18, 0.80),
        (0.46, 0.80),
        (0.74, 0.80),
    ]
    for (row, col), note_digits in (notes or {}).items():
        for digit in note_digits:
            slot_x, slot_y = note_slots[digit - 1]
            x = int((col - 1) * cell + cell * slot_x - 5)
            y = int((row - 1) * cell + cell * slot_y + 5)
            cv2.putText(image, str(digit), (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.38, 0, 1, cv2.LINE_AA)

    ok, encoded = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("failed to encode synthetic Sudoku image")
    return encoded.tobytes()
