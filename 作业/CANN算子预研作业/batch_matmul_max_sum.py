"""CPU teaching prototype for the public CANN BatchMatmulMaxSum problem.

This module does not compile or run Ascend C and is not a contest submission.
Input storage is quantized to FP16/BF16, accumulation uses Python FP64, and
the output is rounded to FP32.  No NPU speed or FP32 accumulation is claimed.
"""

from dataclasses import dataclass
import math
import struct
from typing import Iterable, List, Tuple


def float32(value: float) -> float:
    """Round to IEEE-754 binary32; reject a non-finite result."""
    result = struct.unpack("<f", struct.pack("<f", value))[0]
    if not math.isfinite(result):
        raise ValueError("value overflows finite float32")
    return result


def quantize(value: float, dtype: str) -> float:
    """Return the stored FP16/BF16 value as a Python float (nearest-even)."""
    if dtype not in ("float16", "bfloat16"):
        raise ValueError("dtype must be float16 or bfloat16")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("inputs must be finite")
    try:
        if dtype == "float16":
            result = struct.unpack("<e", struct.pack("<e", value))[0]
        else:
            bits = struct.unpack("<I", struct.pack("<f", value))[0]
            # Keep the high 16 bits; ties round to an even low retained bit.
            rounded = ((bits + 0x7FFF + ((bits >> 16) & 1)) >> 16) << 16
            result = struct.unpack("<f", struct.pack("<I", rounded))[0]
    except (OverflowError, struct.error) as exc:
        raise ValueError("input overflows the selected dtype") from exc
    if not math.isfinite(result):
        raise ValueError("input overflows the selected dtype")
    return result


@dataclass(frozen=True)
class Tensor:
    """Immutable, contiguous, rank-3 tensor in row-major storage."""

    values: Tuple[float, ...]
    shape: Tuple[int, int, int]
    dtype: str = "float16"

    def __post_init__(self) -> None:
        shape = tuple(self.shape)
        if len(shape) != 3 or any(type(d) is not int or d <= 0 for d in shape):
            raise ValueError("shape must contain three positive integers")
        values = tuple(self.values)
        if len(values) != math.prod(shape):
            raise ValueError("data length must equal the product of shape")
        if self.dtype not in ("float16", "bfloat16"):
            raise ValueError("dtype must be float16 or bfloat16")
        object.__setattr__(self, "shape", shape)
        object.__setattr__(self, "values", tuple(quantize(v, self.dtype) for v in values))

    def at(self, batch: int, row: int, column: int) -> float:
        return self.values[(batch * self.shape[1] + row) * self.shape[2] + column]


def _dimensions(x1: Tensor, x2: Tensor, tx1: bool, tx2: bool) -> Tuple[int, int, int, int]:
    if type(tx1) is not bool or type(tx2) is not bool:
        raise ValueError("storage-layout flags must be bool")
    if x1.dtype != x2.dtype:
        raise ValueError("both input dtypes must match")
    batch, m, k1 = x1.shape if not tx1 else (x1.shape[0], x1.shape[2], x1.shape[1])
    batch2, k2, n = x2.shape if not tx2 else (x2.shape[0], x2.shape[2], x2.shape[1])
    if batch != batch2 or k1 != k2:
        raise ValueError("batch and logical K must match; broadcasting is unsupported")
    return batch, m, n, k1


def dense_reference(x1: Tensor, x2: Tensor, transpose_x1: bool = False,
                    transpose_x2: bool = False) -> List[float]:
    """Materialize similarities, then reduce Max(N) followed by Sum(M).

    FP64 fsum is the teaching golden, based on the quantized storage values.
    The layout flags interpret physical storage and never alter the formula.
    """
    batch, m_size, n_size, k_size = _dimensions(x1, x2, transpose_x1, transpose_x2)
    output = []
    for b in range(batch):
        similarity = []
        for m in range(m_size):
            row = []
            for n in range(n_size):
                products = (
                    x1.at(b, k, m) * x2.at(b, n, k) if transpose_x1 and transpose_x2
                    else x1.at(b, k, m) * x2.at(b, k, n) if transpose_x1
                    else x1.at(b, m, k) * x2.at(b, n, k) if transpose_x2
                    else x1.at(b, m, k) * x2.at(b, k, n)
                    for k in range(k_size)
                )
                row.append(math.fsum(products))
            similarity.append(row)
        output.append(float32(math.fsum(max(row) for row in similarity)))
    return output


def tiled_prototype(x1: Tensor, x2: Tensor, transpose_x1: bool = False,
                    transpose_x2: bool = False, tile_m: int = 8,
                    tile_n: int = 16, tile_k: int = 8) -> List[float]:
    """CPU model of tiling and online MaxSim, with FP64 accumulation.

    Only a tile_m * tile_n similarity tile and tile_m row maxima are needed.
    This illustrates memory reuse; Python runtime is not an NPU benchmark.
    """
    batch, m_size, n_size, k_size = _dimensions(x1, x2, transpose_x1, transpose_x2)
    if any(type(t) is not int or t <= 0 for t in (tile_m, tile_n, tile_k)):
        raise ValueError("tile sizes must be positive integers")
    output = []
    for b in range(batch):
        batch_sum = 0.0
        for m0 in range(0, m_size, tile_m):
            m_count = min(tile_m, m_size - m0)
            maxima = [-math.inf] * m_count
            for n0 in range(0, n_size, tile_n):
                n_count = min(tile_n, n_size - n0)
                tile = [[0.0] * n_count for _ in range(m_count)]
                for k0 in range(0, k_size, tile_k):
                    for mi in range(m_count):
                        m = m0 + mi
                        for ni in range(n_count):
                            n = n0 + ni
                            for k in range(k0, min(k0 + tile_k, k_size)):
                                a = x1.at(b, k, m) if transpose_x1 else x1.at(b, m, k)
                                v = x2.at(b, n, k) if transpose_x2 else x2.at(b, k, n)
                                tile[mi][ni] += a * v
                for mi, row in enumerate(tile):
                    maxima[mi] = max(maxima[mi], max(row))
            batch_sum += math.fsum(maxima)
        output.append(float32(batch_sum))
    return output


def store_logical(values: Iterable[float], shape: Tuple[int, int, int],
                  transpose_storage: bool = False, dtype: str = "float16") -> Tensor:
    """Prepare test data; optional transpose changes storage, not semantics."""
    logical = Tensor(tuple(values), shape, dtype)
    if not transpose_storage:
        return logical
    batch, rows, cols = logical.shape
    return Tensor(tuple(logical.at(b, row, col) for b in range(batch)
                        for col in range(cols) for row in range(rows)),
                  (batch, cols, rows), dtype)
