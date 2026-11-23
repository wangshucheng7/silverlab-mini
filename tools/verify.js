#!/usr/bin/env node
// 微信小程序工程、Shader Uniform 与 3D LUT 像素级一致性自检脚本

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MINIPROGRAM_DIR = path.join(ROOT, 'miniprogram');

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

// 递归收集指定后缀文件
function walkFiles(dir, ext) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

// 纯 Node 解析 8-bit 非交错 PNG（支持 RGB / RGBA 及标准 PNG 行滤波器）
function decodePng(filePath) {
  const buf = fs.readFileSync(filePath);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert(buf.subarray(0, 8).equals(sig), `无效 PNG 文件头: ${filePath}`);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  assert(bitDepth === 8, `仅支持 8-bit PNG，实际为 ${bitDepth}: ${filePath}`);
  const bpp = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  assert(bpp > 0, `不支持的 PNG colorType=${colorType}: ${filePath}`);

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * bpp;
  const pixels = new Uint8Array(width * height * 3);
  const prevRow = new Uint8Array(stride);
  const currRow = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    for (let x = 0; x < stride; x++) {
      const val = raw[rowStart + 1 + x];
      const a = x >= bpp ? currRow[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      let recon = val;
      if (filter === 1) recon = (val + a) & 0xff;
      else if (filter === 2) recon = (val + b) & 0xff;
      else if (filter === 3) recon = (val + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        recon = (val + pr) & 0xff;
      }
      currRow[x] = recon;
    }
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 3;
      const src = x * bpp;
      pixels[dst] = currRow[src];
      pixels[dst + 1] = currRow[src + 1];
      pixels[dst + 2] = currRow[src + 2];
    }
    prevRow.set(currRow);
  }

  return { width, height, pixels };
}

// 与 GLSL sampleLUT 完全一致的 CPU 2D 双线性 + B 轴线性插值验证
function sampleStripLut(pixels, size, rgb) {
  const width = size * size;
  const height = size;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const cr = clamp01(rgb[0]);
  const cg = clamp01(rgb[1]);
  const cb = clamp01(rgb[2]);

  const slice = cb * (size - 1);
  const slice0 = Math.floor(slice);
  const slice1 = Math.min(slice0 + 1, size - 1);
  const fracB = slice - slice0;

  const sample2d = (uNorm, vNorm) => {
    const px = uNorm * width - 0.5;
    const py = vNorm * height - 0.5;
    const x0 = Math.max(0, Math.min(width - 1, Math.floor(px)));
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(py)));
    const x1 = Math.max(0, Math.min(width - 1, x0 + 1));
    const y1 = Math.max(0, Math.min(height - 1, y0 + 1));
    const fx = Math.max(0, Math.min(1, px - x0));
    const fy = Math.max(0, Math.min(1, py - y0));

    const getPx = (x, y) => {
      const idx = (y * width + x) * 3;
      return [pixels[idx] / 255, pixels[idx + 1] / 255, pixels[idx + 2] / 255];
    };

    const c00 = getPx(x0, y0);
    const c10 = getPx(x1, y0);
    const c01 = getPx(x0, y1);
    const c11 = getPx(x1, y1);

    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const top = c00[k] * (1 - fx) + c10[k] * fx;
      const bot = c01[k] * (1 - fx) + c11[k] * fx;
      out[k] = top * (1 - fy) + bot * fy;
    }
    return out;
  };

  const uOffset = (0.5 + cr * (size - 1)) / (size * size);
  const v = (0.5 + cg * (size - 1)) / size;
  const col0 = sample2d(slice0 / size + uOffset, v);
  const col1 = sample2d(slice1 / size + uOffset, v);

  return [
    col0[0] * (1 - fracB) + col1[0] * fracB,
    col0[1] * (1 - fracB) + col1[1] * fracB,
    col0[2] * (1 - fracB) + col1[2] * fracB
  ];
}

function checkJsSyntax() {
  const jsFiles = walkFiles(MINIPROGRAM_DIR, '.js');
  assert(jsFiles.length > 0, 'miniprogram 下未找到 JS 文件');
  for (const file of jsFiles) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
  console.log(`[PASS] JS 语法检查通过 (${jsFiles.length} 个文件)`);
}

function checkProjectStructure() {
  const jsonPaths = [
    path.join(ROOT, 'project.config.json'),
    path.join(MINIPROGRAM_DIR, 'app.json'),
    path.join(MINIPROGRAM_DIR, 'sitemap.json'),
    path.join(MINIPROGRAM_DIR, 'pages/index/index.json')
  ];
  for (const p of jsonPaths) {
    assert(fs.existsSync(p), `缺少配置文件: ${p}`);
    JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  const appJson = JSON.parse(fs.readFileSync(path.join(MINIPROGRAM_DIR, 'app.json'), 'utf8'));
  assert(Array.isArray(appJson.pages) && appJson.pages.length > 0, 'app.json pages 不能为空');
  for (const page of appJson.pages) {
    for (const ext of ['.wxml', '.wxss', '.js', '.json']) {
      const target = path.join(MINIPROGRAM_DIR, `${page}${ext}`);
      assert(fs.existsSync(target), `缺少页面文件: ${target}`);
    }
  }
  console.log(`[PASS] 小程序 JSON 配置与页面文件完整 (${appJson.pages.length} 个页面)`);
}

function checkShaders() {
  const rendererSrc = fs.readFileSync(path.join(MINIPROGRAM_DIR, 'utils/film-renderer.js'), 'utf8');
  assert(!rendererSrc.includes('UNPACK_FLIP_Y_WEBGL, true'), '禁止开启 UNPACK_FLIP_Y_WEBGL=true');

  const { VERTEX_SHADER, FRAGMENT_SHADER, UNIFORM_NAMES } = require(path.join(MINIPROGRAM_DIR, 'utils/film-renderer.js'));
  const uniformRegex = /^\s*uniform\s+\w+\s+(\w+)\s*;/gm;
  const declared = new Set();
  for (const shader of [VERTEX_SHADER, FRAGMENT_SHADER]) {
    let match;
    while ((match = uniformRegex.exec(shader)) !== null) {
      declared.add(match[1]);
    }
  }

  const listed = new Set(UNIFORM_NAMES);
  assert(declared.size === listed.size, `Shader uniform 数量 (${declared.size}) 与 UNIFORM_NAMES (${listed.size}) 不一致`);
  for (const name of declared) {
    assert(listed.has(name), `UNIFORM_NAMES 缺少 Shader 声明: ${name}`);
  }
  for (const name of listed) {
    assert(declared.has(name), `Shader 缺少 UNIFORM_NAMES 中的声明: ${name}`);
  }
  console.log(`[PASS] 着色器 Uniform 一致性校验通过 (${declared.size} 个 uniform)`);
}

function checkLutsAndFilms() {
  const { FILMS } = require(path.join(MINIPROGRAM_DIR, 'config/films.js'));
  assert(Array.isArray(FILMS) && FILMS.length >= 7, 'FILMS 应至少包含 1 个原片与 6 款胶片');

  const lutFilms = FILMS.filter((f) => f.lutPath);
  assert(lutFilms.length >= 6, `有效胶片 LUT 不足 6 款，当前: ${lutFilms.length}`);

  // 1. 恒等 LUT 采样算法自检
  const N = 33;
  const idPixels = new Uint8Array(N * N * N * 3);
  for (let g = 0; g < N; g++) {
    for (let b = 0; b < N; b++) {
      for (let r = 0; r < N; r++) {
        const idx = (g * (N * N) + b * N + r) * 3;
        idPixels[idx] = Math.round((r / (N - 1)) * 255);
        idPixels[idx + 1] = Math.round((g / (N - 1)) * 255);
        idPixels[idx + 2] = Math.round((b / (N - 1)) * 255);
      }
    }
  }
  const testPts = [
    [0, 0, 0],
    [1, 1, 1],
    [0.5, 0.5, 0.5],
    [0.83, 0.41, 0.19],
    [0.12, 0.77, 0.64]
  ];
  for (const pt of testPts) {
    const out = sampleStripLut(idPixels, N, pt);
    for (let k = 0; k < 3; k++) {
      assert(Math.abs(out[k] - pt[k]) <= 1 / 255 + 1e-6, `恒等 LUT 三线性插值误差过大: ${pt} -> ${out}`);
    }
  }

  // 2. 验证 6 张实际烘焙出的 spektrafilm LUT PNG 及资产目录洁净度
  const lutsDir = path.join(MINIPROGRAM_DIR, 'assets/luts');
  const referencedFiles = new Set(lutFilms.map((f) => path.basename(f.lutPath)));
  const diskFiles = fs.readdirSync(lutsDir).filter((name) => name.endsWith('.png'));
  for (const diskFile of diskFiles) {
    assert(referencedFiles.has(diskFile), `发现未被 films.js 引用的多余 LUT 文件: ${diskFile}`);
  }

  let totalBytes = 0;
  for (const film of lutFilms) {
    const rel = film.lutPath.replace(/^\/+/, '');
    const fullPath = path.join(MINIPROGRAM_DIR, rel);
    assert(fs.existsSync(fullPath), `LUT 文件不存在: ${fullPath}`);
    const stat = fs.statSync(fullPath);
    totalBytes += stat.size;
    assert(stat.size < 150 * 1024, `单张 LUT 过大 (${stat.size} bytes): ${rel}`);

    const decoded = decodePng(fullPath);
    const expectedSize = film.lutSize || 33;
    assert(
      decoded.width === expectedSize * expectedSize && decoded.height === expectedSize,
      `LUT 尺寸错误 ${rel}: ${decoded.width}x${decoded.height}, 期望 ${expectedSize * expectedSize}x${expectedSize}`
    );

    const black = sampleStripLut(decoded.pixels, expectedSize, [0, 0, 0]);
    const white = sampleStripLut(decoded.pixels, expectedSize, [1, 1, 1]);
    const mid = sampleStripLut(decoded.pixels, expectedSize, [0.5, 0.5, 0.5]);
    const skin = sampleStripLut(decoded.pixels, expectedSize, [0.8, 0.6, 0.5]);
    const pureR = sampleStripLut(decoded.pixels, expectedSize, [1, 0, 0]);
    const pureG = sampleStripLut(decoded.pixels, expectedSize, [0, 1, 0]);
    const pureB = sampleStripLut(decoded.pixels, expectedSize, [0, 0, 1]);

    for (const v of [...black, ...white, ...mid, ...skin, ...pureR, ...pureG, ...pureB]) {
      assert(v >= 0 && v <= 1, `LUT 采样越界: ${rel}`);
    }

    // 校验中灰曝光落在正常影调区间，避免整体发白或偏色坏图
    for (let ch = 0; ch < 3; ch++) {
      assert(
        mid[ch] >= 0.35 && mid[ch] <= 0.62,
        `${film.code} 中灰通道 ${ch} 异常 (${mid[ch].toFixed(3)}): ${mid}`
      );
    }

    // 校验 RGB 轴向顺序未错位
    assert(pureR[0] > pureR[2], `${film.code} 纯红通道异常: ${pureR}`);
    assert(pureG[1] > pureG[2], `${film.code} 纯绿通道异常: ${pureG}`);
    assert(pureB[2] > pureB[0], `${film.code} 纯蓝通道异常: ${pureB}`);

    // 校验多色点综合色彩映射偏移显著（非恒等直通图）
    const samples = [
      [black, [0, 0, 0]],
      [white, [1, 1, 1]],
      [mid, [0.5, 0.5, 0.5]],
      [skin, [0.8, 0.6, 0.5]]
    ];
    let totalL1 = 0;
    for (const [actual, ref] of samples) {
      totalL1 += Math.abs(actual[0] - ref[0]) + Math.abs(actual[1] - ref[1]) + Math.abs(actual[2] - ref[2]);
    }
    assert(totalL1 > 0.15, `LUT 多色点 L1 映射差异过小 (${totalL1.toFixed(3)}): ${rel}`);

    console.log(
      `  - ${film.code} (${path.basename(fullPath)}, ${(stat.size / 1024).toFixed(1)} KB): ` +
        `灰[0.5]->[${mid.map((n) => n.toFixed(3)).join(', ')}], L1=${totalL1.toFixed(3)}`
    );
  }

  assert(totalBytes < 600 * 1024, `LUT 总体积超出 600 KB 限制: ${(totalBytes / 1024).toFixed(1)} KB`);
  console.log(`[PASS] 全部 ${lutFilms.length} 张 LUT PNG 像素校验通过 (总体积 ${(totalBytes / 1024).toFixed(1)} KB)`);
}

function main() {
  checkJsSyntax();
  checkProjectStructure();
  checkShaders();
  checkLutsAndFilms();
  console.log('ALL CHECKS PASSED');
}

main();
