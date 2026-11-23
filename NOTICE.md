# Third-Party Attribution & Asset Licenses (NOTICE)

## 1. 物理光谱胶片 LUT 资产（CC BY-SA 4.0）

本项目 `miniprogram/assets/luts/` 目录下的全部 3D LUT 纹理文件（`p400.png`、`g200.png`、`v50d.png`、`v500t.png`、`f400h.png`、`e100.png`），均基于 **spektrafilm** 项目生成并打包为 `1089x33` 2D Strip PNG 格式：

- **Derived from**: `spektrafilm` by **Andrea Volpato**
- **Canonical Source**: https://github.com/andreavolpato/spektrafilm
- **License**: Creative Commons Attribution-ShareAlike 4.0 International (**CC BY-SA 4.0**)
- **Full License Text**: 参见本仓库根目录未修改的 [SPEKTRAFILM_LICENSE.txt](SPEKTRAFILM_LICENSE.txt)，以及上游仓库 https://github.com/andreavolpato/spektrafilm/blob/main/SPEKTRAFILM_LICENSE.txt

### 资产变更与生成说明
- 生成工具：`spektrafilm` v0.3.4 (`spektrafilm_lut_creator.builders.BundleBuilder`)，由 `tools/build_luts.py` 调用。
- 色彩空间与标定参数：`input_color_space="sRGB"`、`output_color_space="sRGB"`、`topology="1lut"`、`resolution=33`、`stops_above_midgray=None`（保持 sRGB 原生中灰曝光基准，无额外提亮增益）。
- 存储格式：将 `33×33×33` 立方查找表展平编码为无损 `1089×33` RGB PNG（`row = g, col = b * 33 + r`），以兼容微信小程序 WebGL 1.0 纹理采样。

| 小程序资产文件 | 展示代号 | 对应 `spektrafilm` 胶片配置 | 对应暗房相纸配置 |
| :--- | :--- | :--- | :--- |
| `p400.png` | `P400` | `kodak_portra_400` | `kodak_portra_endura` |
| `g200.png` | `G200` | `kodak_gold_200` | `kodak_ektacolor_edge` |
| `v50d.png` | `V50D` | `kodak_vision3_50d` | `kodak_2383` |
| `v500t.png` | `V500T` | `kodak_vision3_500t` | `kodak_2393` |
| `f400h.png` | `F400H` | `fujifilm_pro_400h` | `fujifilm_crystal_archive_typeii` |
| `e100.png` | `E100` | `kodak_ektar_100` | `kodak_ultra_endura` |

> **注**：上述 `miniprogram/assets/luts/*.png` 衍生文件继续以 **CC BY-SA 4.0** 协议对外共享。

---

## 2. 小程序源码与构建脚本（MIT License）

本仓库中的原生微信小程序代码（`miniprogram/` 下除 `assets/luts/` 外的全部代码）与构建/校验脚本（`tools/`）均由项目贡献者独立编写，采用 **MIT License** 开源，详见 [LICENSE](LICENSE)。

---

## 3. 商标与命名说明

- 本项目品牌命名为 **SILVERLAB（银盐暗房）**，未使用 `spektrafilm` 或原作者姓名作为产品品牌名称；仅在文档与关于信息中作事实性技术致谢（“物理光谱胶片 LUT 基于 `spektrafilm` 生成”）。
- 小程序前端展示的胶卷代号（`P400`、`G200`、`V50D`、`V500T`、`F400H`、`E100`）均为通用非商标简写代号，不直接使用第三方胶片厂商的注册商标名称。
