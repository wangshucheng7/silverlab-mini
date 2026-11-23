# SILVERLAB（银盐暗房）— 物理光谱胶片模拟微信小程序

一款轻量、开源、零服务端依赖的原生微信小程序。基于 [spektrafilm](https://github.com/andreavolpato/spektrafilm) 物理光谱建模离线烘焙的高精度 3D LUT，结合小程序端自研 **WebGL 1.0** 实时渲染引擎，在手机本地毫秒级还原胶片色彩、前级高光红晕、银盐颗粒与暗房相纸边框。

> **隐私优先**：所有照片读取、渲染与 2048px 高清冲印均在用户手机端侧离线完成，照片永不上传任何服务器。

---

## 核心特性

- **6 款真实物理光谱负片 LUT**：覆盖暖柔人像（`P400`）、阳光复古（`G200`）、日光电影（`V50D`）、夜景蓝调（`V500T`）、日系清透（`F400H`）与鲜艳街拍（`E100`），全部采用无损 `1089×33` 2D Strip PNG（6 张合计仅 `153.7 KB`）。
- **单 Pass WebGL 暗房管线**：
  - 线性空间近似曝光补偿（`-2.0 ~ +2.0 EV`）
  - LUT 前级高光红晕（Halation，按短边归一化采样，高光沿胶片肩部曲线自然滚落）
  - 精确 3D LUT 三线性插值（WebGL 1.0 全端兼容）
  - 960px 虚拟网格归一化中间调胶片颗粒（保证预览与导出颗粒粗细一致）
  - 柔和镜头暗角
- **极简暗房交互**：长按画布秒看原图对比、一键开关「相纸白边」与「石英日期戳」，所见即所得。
- **稳定高清导出**：独立离屏 WebGL + 2D Canvas 合成，长边上限 `2048px`，渲染后立即显式释放显存，防 iOS/Android OOM 闪退。

---

## 快速开始（运行与预览）

### 1. 直接打开小程序源码
1. 打开 **微信开发者工具**，导入本项目根目录（`project.config.json` 已配置 `"miniprogramRoot": "miniprogram/"`）。
2. 当前默认 `appid` 为 `touristappid`（游客测试模式），点击编译即可在模拟器预览完整界面与流程。
3. 如需真机调试或提交审核，请在 `project.config.json` 中替换为你自己的微信小程序 `appid`（无需配置任何服务器域名）。

### 2. 本地校验项目完整性
项目内置零依赖 Node 校验脚本，可验证 JS 语法、JSON 配置、Shader Uniform 一致性与 6 张 LUT PNG 像素三线性采样准确性：

```bash
node tools/verify.js
```

---

## 离线扩展或重新烘焙胶片 LUT

如果你想基于 `spektrafilm` 扩展更多胶片/相纸组合，可使用 `tools/build_luts.py`：

```bash
# 1. 创建隔离 Python 虚拟环境并安装 spektrafilm
python3 -m venv .venv
.venv/bin/pip install "git+https://github.com/andreavolpato/spektrafilm.git"

# 2. 编辑 tools/build_luts.py 中的 PRESETS，然后运行烘焙脚本
.venv/bin/python tools/build_luts.py

# 3. 更新 miniprogram/config/films.js 中的胶卷配置并运行自检
node tools/verify.js
```

> 说明：`tools/build_luts.py` 直接调用 `spektrafilm_lut_creator.builders.BundleBuilder` 并设置 `stops_above_midgray=None`，保持面向 sRGB 手机照片的原生中灰曝光基准（`0.475 ~ 0.520`），避免出现过曝泛白。

---

## 开源协议与致谢

本项目采用双协议发布，商业与个人使用前请遵守各自许可要求：

- **小程序前端代码与构建脚本**（`miniprogram/` 除 `assets/luts/` 外、`tools/`）：基于 [MIT License](LICENSE) 开源。
- **胶片 3D LUT 纹理资产**（`miniprogram/assets/luts/*.png`）：基于 [Andrea Volpato / spektrafilm](https://github.com/andreavolpato/spektrafilm) 生成，遵循 **CC BY-SA 4.0** 协议发布，详细署名与协议全文见 [NOTICE.md](NOTICE.md) 及 [SPEKTRAFILM_LICENSE.txt](SPEKTRAFILM_LICENSE.txt)。

真诚感谢 Andrea Volpato 开源 `spektrafilm` 物理光谱胶片模型，让高质量胶片色彩科学可以在移动端轻量落地。
