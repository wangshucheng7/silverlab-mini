#!/usr/bin/env python3
"""直接调用 spektrafilm Python API 离线烘焙校准 sRGB 33^3 3D LUT 并转为 1089x33 Strip PNG。"""

import shutil
from pathlib import Path

import numpy as np
from PIL import Image
from spektrafilm_lut_creator.builders import BundleBuilder
from spektrafilm_lut_creator.bundles import BundleSpec

ROOT = Path(__file__).resolve().parent.parent
TMP_DIR = ROOT / "tools" / "build_tmp"
OUT_DIR = ROOT / "miniprogram" / "assets" / "luts"

# 精选 6 款风格鲜明且均已验证 is_negative=True 的真实物理胶片与相纸组合
PRESETS = [
    {
        "id": "p400",
        "film": "kodak_portra_400",
        "print": "kodak_portra_endura",
        "resolution": 33,
    },
    {
        "id": "g200",
        "film": "kodak_gold_200",
        "print": "kodak_ektacolor_edge",
        "resolution": 33,
    },
    {
        "id": "v50d",
        "film": "kodak_vision3_50d",
        "print": "kodak_2383",
        "resolution": 33,
    },
    {
        "id": "v500t",
        "film": "kodak_vision3_500t",
        "print": "kodak_2393",
        "resolution": 33,
    },
    {
        "id": "f400h",
        "film": "fujifilm_pro_400h",
        "print": "fujifilm_crystal_archive_typeii",
        "resolution": 33,
    },
    {
        "id": "e100",
        "film": "kodak_ektar_100",
        "print": "kodak_ultra_endura",
        "resolution": 33,
    },
]


def cube_to_strip_png(lut_bgr: np.ndarray, out_png_path: Path) -> None:
    """将 (N, N, N, 3) 的 [b, g, r, rgb] LUT 展平保存为 (N*N, N) 无损 RGB Strip PNG。"""
    n = lut_bgr.shape[0]
    strip = lut_bgr.transpose(1, 0, 2, 3).reshape((n, n * n, 3))
    rgb_u8 = np.clip(np.rint(strip * 255.0), 0, 255).astype(np.uint8)
    out_png_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb_u8, mode="RGB").save(out_png_path, format="PNG", optimize=True)


def self_check() -> None:
    """用恒等 33^3 LUT 验证 Strip 映射的轴顺序、通道顺序和像素往返误差为 0。"""
    n = 33
    b_idx, g_idx, r_idx = np.meshgrid(
        np.arange(n), np.arange(n), np.arange(n), indexing="ij"
    )
    lut_bgr = np.stack([r_idx, g_idx, b_idx], axis=-1).astype(np.float32) / float(n - 1)

    tmp_png = TMP_DIR / "_self_check_identity.png"
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    cube_to_strip_png(lut_bgr, tmp_png)

    loaded = np.asarray(Image.open(tmp_png).convert("RGB"), dtype=np.uint8)
    assert loaded.shape == (n, n * n, 3), f"自检图像尺寸异常: {loaded.shape}"

    rng = np.random.default_rng(42)
    points = [
        (0, 0, 0),
        (n - 1, 0, 0),
        (0, n - 1, 0),
        (0, 0, n - 1),
        (n - 1, n - 1, 0),
        (n - 1, 0, n - 1),
        (0, n - 1, n - 1),
        (n - 1, n - 1, n - 1),
    ]
    for _ in range(32):
        points.append(tuple(int(x) for x in rng.integers(0, n, size=3)))

    for r, g, b in points:
        pixel = loaded[g, b * n + r]
        expected = np.rint(np.array([r, g, b], dtype=np.float32) / (n - 1) * 255.0).astype(np.uint8)
        if not np.array_equal(pixel, expected):
            raise AssertionError(f"恒等 LUT 采样不匹配 ({r},{g},{b}): got={pixel}, expected={expected}")

    tmp_png.unlink(missing_ok=True)
    print("[PASS] 恒等 33^3 LUT Strip 编码与坐标往返自检通过 (误差 = 0)")


def validate_lut_array(pid: str, lut_bgr: np.ndarray) -> None:
    """校验烘焙后 LUT 的轴顺序与中灰曝光响应，防止偏色或过曝坏图。"""
    n = lut_bgr.shape[0]
    assert lut_bgr.shape == (n, n, n, 3), f"{pid} 形状异常: {lut_bgr.shape}"
    assert not np.isnan(lut_bgr).any(), f"{pid} 包含 NaN"

    # 验证 [b, g, r] 轴顺序与 RGB 通道一致
    blue_pt = lut_bgr[n - 1, 0, 0]
    green_pt = lut_bgr[0, n - 1, 0]
    red_pt = lut_bgr[0, 0, n - 1]
    assert blue_pt[2] > blue_pt[0], f"{pid} 纯蓝采样异常: {blue_pt}"
    assert green_pt[1] > green_pt[2], f"{pid} 纯绿采样异常: {green_pt}"
    assert red_pt[0] > red_pt[2], f"{pid} 纯红采样异常: {red_pt}"

    mid = lut_bgr[n // 2, n // 2, n // 2]
    for ch_idx, val in enumerate(mid):
        assert 0.35 <= val <= 0.62, f"{pid} 中灰通道 {ch_idx} 越界 ({val:.3f})，存在过曝或严重偏色: {mid}"


def bake_preset(preset: dict) -> Path:
    """绕过 spektrafilm-lut CLI 参数拼写 bug，直调 BundleBuilder 保持 sRGB 原生中灰曝光。"""
    pid = preset["id"]
    res = preset.get("resolution", 33)
    spec = BundleSpec(
        film_profile=preset["film"],
        print_profiles=(preset["print"],),
        input_color_space="sRGB",
        output_color_space="sRGB",
        topology="1lut",
        resolution=res,
        stops_above_midgray=None,
    )
    bundle = BundleBuilder(spec).build()
    _, lut_obj = bundle.luts[0]
    lut_bgr = np.asarray(lut_obj.table, dtype=np.float32)

    validate_lut_array(pid, lut_bgr)

    out_png = OUT_DIR / f"{pid}.png"
    cube_to_strip_png(lut_bgr, out_png)

    mid = lut_bgr[res // 2, res // 2, res // 2]
    white = lut_bgr[res - 1, res - 1, res - 1]
    size_kb = out_png.stat().st_size / 1024.0
    print(
        f"  -> {pid}.png ({res * res}x{res}, {size_kb:.1f} KB) "
        f"| mean={lut_bgr.mean():.3f}, mid=[{mid[0]:.3f}, {mid[1]:.3f}, {mid[2]:.3f}], "
        f"white=[{white[0]:.3f}, {white[1]:.3f}, {white[2]:.3f}]"
    )
    return out_png


def main() -> None:
    self_check()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"开始通过 BundleBuilder (sRGB 原生曝光) 烘焙 {len(PRESETS)} 套物理光谱负片 LUT...")
    outputs = [bake_preset(preset) for preset in PRESETS]
    total_kb = sum(p.stat().st_size for p in outputs) / 1024.0
    print(f"[DONE] 全部 {len(outputs)} 张 LUT 生成完成，总大小 {total_kb:.1f} KB")

    if TMP_DIR.exists():
        shutil.rmtree(TMP_DIR)
        print("[CLEAN] 已清理 tools/build_tmp 临时目录")


if __name__ == "__main__":
    main()
