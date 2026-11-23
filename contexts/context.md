# 项目上下文（SILVERLAB 银盐暗房微信小程序）

## 1. 项目定位与目标
- **项目名称**：SILVERLAB（银盐暗房）
- **形态**：原生微信小程序（WebView 渲染 + WebGL 1.0），纯端侧本地照片处理，零服务器成本。
- **核心卖点**：使用 `spektrafilm` 真实物理光谱模型离线烘焙的高精度 3D LUT（33×33×33），搭配前级物理高光红晕、虚拟分辨率归一化胶片颗粒、暗房白边与日期戳，实现照片不上传的实时胶片冲印体验。
- **开源与商业化定位**：
  - 小程序前端渲染引擎、UI 与构建脚本以 **MIT** 开源；
  - 胶片 LUT 纹理资产基于 `andreavolpato/spektrafilm`（**CC BY-SA 4.0**），完整保留归属署名。

---

## 2. 技术架构（路线 A：纯端侧路线）

### 2.1 离线 LUT 烘焙管线 (`tools/build_luts.py`)
- 依赖隔离的 Python `.venv` 环境（已安装 `spektrafilm==0.3.4`）。
- 通过 `spektrafilm_lut_creator.builders.BundleBuilder` 直接构建 `sRGB -> sRGB` 单 LUT（`topology="1lut"`, `resolution=33`, `stops_above_midgray=None`），输出 `1089×33` 无损 RGB Strip PNG。
- **6 款内嵌负片预设**（合计仅 `153.7 KB`，远低于微信小程序 2 MB 主包上限）：

| 代号 | 界面名称 | 风格标签 | 胶片配置 | 相纸配置 | 文件大小 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `RAW` | 原片直出 | 无滤镜 | — | — | — |
| `P400` | 暖柔人像 | 35mm 负片 | `kodak_portra_400` | `kodak_portra_endura` | 24.8 KB |
| `G200` | 阳光复古 | 日常负片 | `kodak_gold_200` | `kodak_ektacolor_edge` | 25.7 KB |
| `V50D` | 日光电影 | 电影负片 | `kodak_vision3_50d` | `kodak_2383` | 25.0 KB |
| `V500T` | 夜景蓝调 | 灯光电影 | `kodak_vision3_500t` | `kodak_2393` | 24.7 KB |
| `F400H` | 日系清透 | 专业负片 | `fujifilm_pro_400h` | `fujifilm_crystal_archive_typeii` | 25.3 KB |
| `E100` | 鲜艳街拍 | 细颗粒负片 | `kodak_ektar_100` | `kodak_ultra_endura` | 28.1 KB |

### 2.2 小程序端 WebGL 渲染管线 (`miniprogram/utils/film-renderer.js`)
1. **实时预览**：`<canvas type="webgl" id="previewCanvas">` 单 Pass 片元着色器按需重绘（非持续 `requestAnimationFrame` 循环，省电防挂起）：
   - **曝光补偿**：近似线性空间增益调节（`pow(max(c, 1e-5), 2.2)`，规避低端 GPU `pow(0, y)` NaN 问题）。
   - **高光红晕（Halation）**：在 3D LUT 之前按短边归一化两圈 12 点采样提取高光能量，注入胶片基底橙红反射光，经由 LUT 肩部曲线自然滚落。
   - **3D LUT 三线性插值**：手工实现 `1089×33` 2D 纹理的片间线性插值 + 片内硬件双线性插值（`LINEAR` + `CLAMP_TO_EDGE` 兼容所有 NPOT WebGL 1.0 设备）。
   - **胶片颗粒与暗角**：颗粒网格按短边归一化到 `960px` 虚拟尺度并加权中间调，保证预览与高清导出颗粒观感完全一致。
2. **高清导出**：
   - 临时创建 `wx.createOffscreenCanvas({ type: 'webgl' })`，长边限制在 `2048px` 内防止移动端 OOM；
   - 开启 `u_flipY = 1.0` 直接让 `gl.readPixels` 输出自顶向下像素，立刻释放 GL 纹理/缓冲/程序并置空引用；
   - 交由 `wx.createOffscreenCanvas({ type: '2d' })` 合成暖白暗房白边（左右上 4.5%、下 12.5% 印制 `SILVERLAB · CODE`）及右下角橙红石英日期戳，写出固定文件 `${wx.env.USER_DATA_PATH}/silverlab_export.jpg` 并保存至相册。

---

## 3. 目录结构
- `project.config.json` / `LICENSE` / `NOTICE.md` / `SPEKTRAFILM_LICENSE.txt` / `README.md`
- `tools/build_luts.py`：离线生成 6 张校准 3D LUT Strip PNG
- `tools/verify.js`：Node 无依赖全量校验脚本（JS 语法、JSON、Shader uniform、PNG 像素级三线性插值与曝光核验）
- `miniprogram/app.*` / `miniprogram/sitemap.json`：全局配置与暗房深炭黑基础样式
- `miniprogram/config/films.js`：胶卷预设与默认暗房参数（含 `isPro` 扩展字段）
- `miniprogram/utils/film-renderer.js`：开源 WebGL 渲染引擎与高清导出实现
- `miniprogram/pages/index/*`：单页暗房交互页面（空态取景框、长按原图对比、白边/日期戳快捷切换、胶卷与滑块面板）

---

## 4. 已踩坑与关键技术记录
1. **`spektrafilm-lut` v0.3.4 CLI 曝光参数失效 Bug**：CLI 定义了 `--stops-above-gray`，但内部映射读取 `stops_above_midgray`（字段名不匹配），导致 CLI 始终退回到默认的 `ENCODED_SDR_DEFAULT_STOPS = 4.0`（线性增益 2.88，sRGB 中灰 0.5 被推高至 ~0.76）。最终改在 `tools/build_luts.py` 中直调 `BundleBuilder` 并传 `stops_above_midgray=None`，使各负片中灰回归 `0.475~0.520` 正常影调。
2. **正片反转片勿直配负片暗房相纸**：`fujifilm_velvia_100` 等反转片属性为 `is_positive=True`，经过负片-正片暗房相纸管线会导致中性灰严重偏红；v1 统一选用 6 款经校验的 `is_negative=True` 胶片+相纸组合。

---

## 5. 商业化与后续迭代规划
- **v1（当前已完成）**：打磨流畅的端侧冲印体验与极简视觉，开源代码与工具脚本在 GitHub / 独立开发者社区冷启动。
- **v1.1（流量主变现）**：利用 `miniprogram/config/films.js` 中预留的 `isPro` 字段，接入微信激励视频广告（`wx.createRewardedVideoAd`）解锁进阶胶卷、批量修图或定制相框；同时可配套外部发码实现免广告 Pro 权益。
- **v2（路线 B 演进，视流量决定）**：接入可选云端完整 `spektrafilm` 物理暗房冲印接口，提供超清 RAW 解析与真实空间扩散光晕。
