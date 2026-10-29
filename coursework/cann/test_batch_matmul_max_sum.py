"""Reproducible CPU tests, not the official contest test set."""

import itertools
import math
import random
import unittest

from batch_matmul_max_sum import (Tensor, dense_reference, quantize,
                                  store_logical, tiled_prototype)


class BatchMatmulMaxSumTests(unittest.TestCase):
    def test_official_basic_example(self):
        x1 = Tensor((1, 0, 0, 1), (1, 2, 2))
        x2 = Tensor((1, 0, -1, 0, 1, 0), (1, 2, 3))
        self.assertEqual(dense_reference(x1, x2), [2.0])
        self.assertEqual(tiled_prototype(x1, x2), [2.0])

    def test_official_all_negative_example(self):
        x1 = Tensor((1, 0), (1, 1, 2))
        x2 = Tensor((-1, -2, 0, 0), (1, 2, 2))
        self.assertEqual(dense_reference(x1, x2), [-1.0])
        self.assertEqual(tiled_prototype(x1, x2, tile_n=1), [-1.0])

    def test_max_then_sum_cannot_be_reversed(self):
        x1 = Tensor((1, 0, 0, 1), (1, 2, 2))
        x2 = Tensor((10, 0, 0, 10), (1, 2, 2))
        # Max across columns then sum rows is 20; reversed order gives 10.
        self.assertEqual(tiled_prototype(x1, x2, tile_m=1, tile_n=1), [20.0])

    def test_batch_pairs_are_independent(self):
        x1 = Tensor((1, 2, 3, 4), (2, 1, 2))
        x2 = Tensor((5, 6, 7, 8), (2, 2, 1))
        self.assertEqual(tiled_prototype(x1, x2), [17.0, 53.0])

    def test_four_storage_layouts_with_non_square_matrices(self):
        a = (1, 2, 3, 4, 5, 6)
        b = (1, 0, -1, 2, 0, 1, 1, -1, 1, 1, 0, 3)
        for tx1, tx2 in itertools.product((False, True), repeat=2):
            with self.subTest(tx1=tx1, tx2=tx2):
                x1 = store_logical(a, (1, 2, 3), tx1)
                x2 = store_logical(b, (1, 3, 4), tx2)
                # Rows are [4, 5, 1, 9] and [10, 11, 1, 21]: 9 + 21 = 30.
                self.assertEqual(dense_reference(x1, x2, tx1, tx2), [30.0])
                self.assertEqual(tiled_prototype(x1, x2, tx1, tx2, 1, 3, 2), [30.0])

    def test_randomized_layouts_dtypes_and_tail_tiles(self):
        rng = random.Random(2505437)
        for dims in ((1, 1, 1, 8), (2, 3, 5, 8), (1, 17, 19, 24), (3, 7, 9, 16)):
            batch, m, n, k = dims
            a = [rng.uniform(-2, 2) for _ in range(batch * m * k)]
            b = [rng.uniform(-2, 2) for _ in range(batch * k * n)]
            for dtype in ("float16", "bfloat16"):
                for tx1, tx2 in itertools.product((False, True), repeat=2):
                    x1 = store_logical(a, (batch, m, k), tx1, dtype)
                    x2 = store_logical(b, (batch, k, n), tx2, dtype)
                    before = (x1.values, x2.values)
                    expected = dense_reference(x1, x2, tx1, tx2)
                    for tiles in ((1, 1, 1), (4, 7, 5), (32, 32, 32)):
                        with self.subTest(dims=dims, dtype=dtype, layout=(tx1, tx2), tiles=tiles):
                            actual = tiled_prototype(x1, x2, tx1, tx2, *tiles)
                            self.assertEqual(len(actual), batch)
                            for got, want in zip(actual, expected):
                                self.assertTrue(math.isclose(got, want, rel_tol=1e-6, abs_tol=1e-6))
                    self.assertEqual((x1.values, x2.values), before)

    def test_zero_input(self):
        self.assertEqual(tiled_prototype(Tensor((0,) * 16, (1, 2, 8)),
                                        Tensor((1,) * 24, (1, 8, 3))), [0.0])

    def test_half_quantization_rounds_to_nearest_even(self):
        self.assertEqual(quantize(1 + 2 ** -11, "float16"), 1.0)
        self.assertEqual(quantize(1 + 3 * 2 ** -11, "float16"), 1 + 2 ** -9)

    def test_bfloat_quantization_rounds_to_nearest_even(self):
        self.assertEqual(quantize(1 + 2 ** -8, "bfloat16"), 1.0)
        self.assertEqual(quantize(1 + 3 * 2 ** -8, "bfloat16"), 1 + 2 ** -6)
        self.assertEqual(quantize(-1 - 2 ** -8, "bfloat16"), -1.0)

    def test_reject_invalid_inputs(self):
        for values, shape, dtype in (((), (0, 1, 1), "float16"),
                                      ((1,), (1, 1, 2), "float16"),
                                      ((1,), (1, 1, 1), "float32"),
                                      ((math.nan,), (1, 1, 1), "float16"),
                                      ((math.inf,), (1, 1, 1), "bfloat16"),
                                      ((1e30,), (1, 1, 1), "float16")):
            with self.subTest(values=values, shape=shape, dtype=dtype):
                with self.assertRaises(ValueError):
                    Tensor(values, shape, dtype)

    def test_reject_mismatched_shape_dtype_or_layout_flag(self):
        x1 = Tensor((1, 2), (1, 1, 2))
        bad = (Tensor((1,), (1, 1, 1)), Tensor((1, 2, 3, 4), (2, 2, 1)),
               Tensor((1, 2), (1, 2, 1), "bfloat16"))
        for x2 in bad:
            with self.assertRaises(ValueError):
                tiled_prototype(x1, x2)
        with self.assertRaises(ValueError):
            tiled_prototype(x1, Tensor((1, 2), (1, 2, 1)), transpose_x1=1)

    def test_reject_invalid_tile_sizes(self):
        x = Tensor((1,), (1, 1, 1))
        for tiles in ((0, 1, 1), (1, -1, 1), (1, 1, 1.5), (True, 1, 1)):
            with self.assertRaises(ValueError):
                tiled_prototype(x, x, False, False, *tiles)

    def test_repeated_runs_are_deterministic(self):
        x1 = Tensor((1, -2, 3, -4), (1, 2, 2))
        x2 = Tensor((1, 2, -3, -4), (1, 2, 2))
        self.assertEqual(tiled_prototype(x1, x2), tiled_prototype(x1, x2))


if __name__ == "__main__":
    unittest.main(verbosity=2)
