"""Small deterministic demonstration; emits no NPU performance claims."""

import json
from batch_matmul_max_sum import Tensor, dense_reference, tiled_prototype


def main():
    x1 = Tensor((1, 0, 0, 1), (1, 2, 2))
    x2 = Tensor((1, 0, -1, 0, 1, 0), (1, 2, 3))
    reference = dense_reference(x1, x2)
    actual = tiled_prototype(x1, x2, tile_m=1, tile_n=2, tile_k=1)
    print(json.dumps({
        "mode": "CPU teaching prototype; not an Ascend C submission",
        "operator": "BatchMatmulMaxSum",
        "x1_storage_shape": x1.shape,
        "x2_storage_shape": x2.shape,
        "input_dtype": x1.dtype,
        "accumulation": "Python FP64",
        "output_rounding": "FP32",
        "reference": reference,
        "tiled": actual,
        "matches": reference == actual,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
