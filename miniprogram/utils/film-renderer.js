// 基于 WebGL 1.0 的胶片实时渲染与高清离屏导出引擎

const VERTEX_SHADER = `
attribute vec2 a_pos;
attribute vec2 a_uv;
uniform float u_flipY;
varying vec2 v_uv;

void main() {
  float y = u_flipY > 0.5 ? -a_pos.y : a_pos.y;
  gl_Position = vec4(a_pos.x, y, 0.0, 1.0);
  v_uv = a_uv;
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D u_image;
uniform sampler2D u_lut;
uniform float u_hasLut;
uniform float u_lutSize;
uniform float u_compareOriginal;
uniform float u_intensity;
uniform float u_exposure;
uniform float u_grain;
uniform float u_halation;
uniform float u_vignette;
uniform vec2 u_resolution;
uniform float u_seed;

varying vec2 v_uv;

// 线性空间近似曝光补偿，避免 pow(0.0) 在部分移动 GPU 上产生异常像素
vec3 applyExposure(vec3 c) {
  if (abs(u_exposure) <= 0.001) {
    return c;
  }
  vec3 lin = pow(max(c, vec3(0.00001)), vec3(2.2)) * exp2(u_exposure);
  return clamp(pow(max(lin, vec3(0.00001)), vec3(1.0 / 2.2)), 0.0, 1.0);
}

// 在 1089x33 展平 2D Strip 纹理上执行精确 3D LUT 三线性插值
vec3 sampleLUT(vec3 color) {
  vec3 c = clamp(color, 0.0, 1.0);
  float size = u_lutSize;
  float slice = c.b * (size - 1.0);
  float slice0 = floor(slice);
  float slice1 = min(slice0 + 1.0, size - 1.0);
  float frac = slice - slice0;
  float uOffset = (0.5 + c.r * (size - 1.0)) / (size * size);
  float v = (0.5 + c.g * (size - 1.0)) / size;
  vec3 col0 = texture2D(u_lut, vec2(slice0 / size + uOffset, v)).rgb;
  vec3 col1 = texture2D(u_lut, vec2(slice1 / size + uOffset, v)).rgb;
  return mix(col0, col1, frac);
}

// 无周期条纹的 2D 伪随机哈希，兼容中低精度片元着色器
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 计算物理前级高光红晕（基于短边归一化两圈共 12 点采样）
float computeHalation(vec2 uv, vec2 uvScale) {
  float innerR = 0.0045;
  float outerR = 0.0110;
  float sum = 0.0;
  float weightSum = 0.0;

  // 内圈 6 点（0, 60, 120, 180, 240, 300 度）
  for (int i = 0; i < 6; i++) {
    float angle = float(i) * 1.04719755;
    vec2 offset = vec2(cos(angle), sin(angle)) * innerR * uvScale;
    vec3 sc = applyExposure(texture2D(u_image, clamp(uv + offset, 0.0, 1.0)).rgb);
    float lum = dot(sc, vec3(0.2126, 0.7152, 0.0722));
    sum += smoothstep(0.78, 1.0, lum) * 0.65;
    weightSum += 0.65;
  }

  // 外圈 6 点（30, 90, 150, 210, 270, 330 度）
  for (int i = 0; i < 6; i++) {
    float angle = float(i) * 1.04719755 + 0.52359877;
    vec2 offset = vec2(cos(angle), sin(angle)) * outerR * uvScale;
    vec3 sc = applyExposure(texture2D(u_image, clamp(uv + offset, 0.0, 1.0)).rgb);
    float lum = dot(sc, vec3(0.2126, 0.7152, 0.0722));
    sum += smoothstep(0.78, 1.0, lum) * 0.35;
    weightSum += 0.35;
  }

  return sum / weightSum;
}

void main() {
  vec4 rawTex = texture2D(u_image, v_uv);

  // 长按对比原图时跳过所有暗房效果
  if (u_compareOriginal > 0.5) {
    gl_FragColor = vec4(rawTex.rgb, 1.0);
    return;
  }

  float resW = max(u_resolution.x, 1.0);
  float resH = max(u_resolution.y, 1.0);
  float minRes = min(resW, resH);

  // 1. 曝光补偿
  vec3 col = applyExposure(rawTex.rgb);

  // 2. 在 3D LUT 之前注入高光红晕，使高光沿胶片肩部曲线自然滚落
  if (u_halation > 0.001) {
    vec2 uvScale = vec2(minRes / resW, minRes / resH);
    float halo = computeHalation(v_uv, uvScale);
    col = clamp(col + vec3(1.0, 0.24, 0.05) * (halo * u_halation * 0.85), 0.0, 1.0);
  }

  // 3. 真实物理光谱 3D LUT 色彩映射与浓度混合
  if (u_hasLut > 0.5 && u_intensity > 0.001) {
    vec3 lutCol = sampleLUT(col);
    col = mix(col, lutCol, clamp(u_intensity, 0.0, 1.0));
  }

  // 4. 归一化到 960px 短边网格的中间调加权胶片颗粒
  if (u_grain > 0.001) {
    vec2 grainGrid = floor(v_uv * (vec2(resW, resH) / minRes) * 960.0);
    vec2 seedOffset = vec2(u_seed * 17.3, u_seed * 31.7);
    float nLuma = hash12(grainGrid + seedOffset) - 0.5;
    vec3 nRgb = vec3(
      hash12(grainGrid + seedOffset + vec2(11.3, 5.7)),
      hash12(grainGrid + seedOffset + vec2(23.1, 17.9)),
      hash12(grainGrid + seedOffset + vec2(37.7, 29.3))
    ) - 0.5;
    vec3 grainVec = mix(vec3(nLuma), nRgb, 0.15);
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float midWeight = 4.0 * luma * (1.0 - luma) + 0.12;
    col = clamp(col + grainVec * (u_grain * 0.14 * midWeight), 0.0, 1.0);
  }

  // 5. 柔和镜头暗角
  if (u_vignette > 0.001) {
    float aspect = resW / resH;
    vec2 centered = (v_uv - 0.5) * vec2(aspect, 1.0);
    float maxDist = length(vec2(0.5 * aspect, 0.5));
    float normDist = length(centered) / max(maxDist, 0.001);
    float vig = smoothstep(0.35, 1.05, normDist);
    col *= (1.0 - vig * u_vignette * 0.58);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

// 统一管理着色器 Uniform 列表，确保编译与传参严格一一对应
const UNIFORM_NAMES = [
  'u_flipY',
  'u_image',
  'u_lut',
  'u_hasLut',
  'u_lutSize',
  'u_compareOriginal',
  'u_intensity',
  'u_exposure',
  'u_grain',
  'u_halation',
  'u_vignette',
  'u_resolution',
  'u_seed'
];

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader 编译失败: ${info}`);
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program 链接失败: ${info}`);
  }
  return program;
}

// 从代码包读取本地 PNG 并转为 Data URI，避免微信开发者工具与真机因丢失前导斜杠触发 __pageframe__ 500 错误
function readPackagePngAsDataUrl(src) {
  if (typeof wx === 'undefined' || !wx.getFileSystemManager) {
    return src;
  }
  const fs = wx.getFileSystemManager();
  const candidates = [src, src.replace(/^\/+/, '')];
  for (let i = 0; i < candidates.length; i++) {
    try {
      const base64 = fs.readFileSync(candidates[i], 'base64');
      if (base64) {
        return `data:image/png;base64,${base64}`;
      }
    } catch (err) {
      // 依次尝试带或不带前导斜杠的代码包路径
    }
  }
  return src;
}

// 通过指定 Canvas 实例创建并加载 Image，严禁跨 Canvas 混用
function loadCanvasImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const resolvedSrc =
      typeof src === 'string' && src.startsWith('/assets/')
        ? readPackagePngAsDataUrl(src)
        : src;
    const img = canvas.createImage();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err || new Error(`图片加载失败: ${src}`));
    img.src = resolvedSrc;
  });
}

function createTextureFromImage(gl, img) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // 显式关闭 Y 轴翻转，与顶点着色器 UV 方向保持全端一致
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  // WebGL 1.0 非 2 的幂纹理必须使用 CLAMP_TO_EDGE + LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

class FilmRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: true
    });
    if (!gl) {
      throw new Error('当前设备不支持 WebGL 渲染');
    }

    this.gl = gl;
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.uniforms = {};
    for (let i = 0; i < UNIFORM_NAMES.length; i++) {
      const name = UNIFORM_NAMES[i];
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }

    // 全屏四边形顶点数据：[posX, posY, u, v]
    const vertices = new Float32Array([
      -1, 1, 0, 0,
      -1, -1, 0, 1,
      1, 1, 1, 0,
      1, -1, 1, 1
    ]);
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
    this.posLoc = gl.getAttribLocation(this.program, 'a_pos');
    this.uvLoc = gl.getAttribLocation(this.program, 'a_uv');
    gl.enableVertexAttribArray(this.posLoc);
    gl.vertexAttribPointer(this.posLoc, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.uvLoc);
    gl.vertexAttribPointer(this.uvLoc, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);

    this.photoTexture = null;
    this.lutTexture = null;
    this.currentLutPath = '';
    this.lutSize = 33;
    this.hasLut = false;
    this.disposed = false;
  }

  async setPhoto(photoPath) {
    if (this.disposed) return null;
    const img = await loadCanvasImage(this.canvas, photoPath);
    if (this.disposed) return null;

    const newTexture = createTextureFromImage(this.gl, img);
    if (this.photoTexture) {
      this.gl.deleteTexture(this.photoTexture);
    }
    this.photoTexture = newTexture;

    return {
      width: img.width,
      height: img.height
    };
  }

  async setLut(lutPath, lutSize = 33) {
    if (this.disposed) return;

    if (!lutPath) {
      if (this.lutTexture) {
        this.gl.deleteTexture(this.lutTexture);
        this.lutTexture = null;
      }
      this.currentLutPath = '';
      this.hasLut = false;
      this.lutSize = lutSize;
      return;
    }

    if (lutPath === this.currentLutPath && this.lutTexture) {
      this.lutSize = lutSize;
      this.hasLut = true;
      return;
    }

    const img = await loadCanvasImage(this.canvas, lutPath);
    if (this.disposed) return;

    const newTexture = createTextureFromImage(this.gl, img);
    if (this.lutTexture) {
      this.gl.deleteTexture(this.lutTexture);
    }
    this.lutTexture = newTexture;
    this.currentLutPath = lutPath;
    this.lutSize = lutSize;
    this.hasLut = true;
  }

  render(params = {}, options = {}) {
    if (this.disposed || !this.photoTexture) return;

    const gl = this.gl;
    const u = this.uniforms;
    const width = this.canvas.width || 1;
    const height = this.canvas.height || 1;

    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(this.posLoc);
    gl.vertexAttribPointer(this.posLoc, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.uvLoc);
    gl.vertexAttribPointer(this.uvLoc, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.photoTexture);
    gl.uniform1i(u.u_image, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture || this.photoTexture);
    gl.uniform1i(u.u_lut, 1);

    gl.uniform1f(u.u_flipY, options.flipY ? 1.0 : 0.0);
    gl.uniform1f(u.u_hasLut, this.hasLut && this.lutTexture ? 1.0 : 0.0);
    gl.uniform1f(u.u_lutSize, this.lutSize || 33);
    gl.uniform1f(u.u_compareOriginal, options.compareOriginal ? 1.0 : 0.0);
    gl.uniform1f(u.u_intensity, params.intensity !== undefined ? params.intensity : 1.0);
    gl.uniform1f(u.u_exposure, params.exposure || 0.0);
    gl.uniform1f(u.u_grain, params.grain || 0.0);
    gl.uniform1f(u.u_halation, params.halation || 0.0);
    gl.uniform1f(u.u_vignette, params.vignette || 0.0);
    gl.uniform2f(u.u_resolution, width, height);
    gl.uniform1f(u.u_seed, options.seed !== undefined ? options.seed : 1.0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    if (this.photoTexture) {
      gl.deleteTexture(this.photoTexture);
      this.photoTexture = null;
    }
    if (this.lutTexture) {
      gl.deleteTexture(this.lutTexture);
      this.lutTexture = null;
    }
    if (this.vertexBuffer) {
      gl.deleteBuffer(this.vertexBuffer);
      this.vertexBuffer = null;
    }
    if (this.program) {
      gl.deleteProgram(this.program);
      this.program = null;
    }
  }
}

// 计算保持原图比例、长边不超过 maxEdge 的偶数输出宽高
function calcExportSize(photoWidth, photoHeight, maxEdge = 2048) {
  const safeW = Math.max(2, photoWidth || 1080);
  const safeH = Math.max(2, photoHeight || 1080);
  const longEdge = Math.max(safeW, safeH);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1.0;
  let outW = Math.max(2, Math.round(safeW * scale));
  let outH = Math.max(2, Math.round(safeH * scale));
  if (outW % 2 !== 0) outW -= 1;
  if (outH % 2 !== 0) outH -= 1;
  return { outW: Math.max(2, outW), outH: Math.max(2, outH) };
}

// 离屏 WebGL 高清冲印并叠加暗房边框与胶片日期戳，写入临时文件后立刻释放显存
async function exportHighRes({
  photoPath,
  photoWidth,
  photoHeight,
  film,
  params,
  showBorder = false,
  showDate = false,
  dateText = '',
  seed = 1.0,
  maxEdge = 2048
}) {
  const { outW, outH } = calcExportSize(photoWidth, photoHeight, maxEdge);
  let offscreenWebgl = wx.createOffscreenCanvas({
    type: 'webgl',
    width: outW,
    height: outH
  });

  let renderer = new FilmRenderer(offscreenWebgl);
  let pixels;
  try {
    await renderer.setPhoto(photoPath);
    if (film && film.lutPath) {
      await renderer.setLut(film.lutPath, film.lutSize || 33);
    }
    // 开启 u_flipY = 1.0，使 readPixels 直接输出自顶向下顺序，省去 CPU 像素翻转开销
    renderer.render(params, { flipY: true, compareOriginal: false, seed });
    renderer.gl.finish();

    pixels = new Uint8Array(outW * outH * 4);
    renderer.gl.readPixels(0, 0, outW, outH, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, pixels);
  } finally {
    renderer.dispose();
    renderer = null;
    offscreenWebgl = null;
  }

  const shortEdge = Math.min(outW, outH);
  const padX = showBorder ? Math.round(shortEdge * 0.045) : 0;
  const padTop = showBorder ? Math.round(shortEdge * 0.045) : 0;
  const padBottom = showBorder ? Math.round(shortEdge * 0.125) : 0;
  const totalW = outW + padX * 2;
  const totalH = outH + padTop + padBottom;

  let canvas2d = wx.createOffscreenCanvas({
    type: '2d',
    width: totalW,
    height: totalH
  });

  try {
    const ctx = canvas2d.getContext('2d');
    if (showBorder) {
      ctx.fillStyle = '#FAF8F5';
      ctx.fillRect(0, 0, totalW, totalH);
    }

    const imageData = ctx.createImageData(outW, outH);
    imageData.data.set(pixels);
    pixels = null;
    ctx.putImageData(imageData, padX, padTop);

    // 绘制照片右下角经典石英胶片日期戳
    if (showDate && dateText) {
      const fontSize = Math.max(18, Math.round(shortEdge * 0.032));
      const marginX = Math.round(shortEdge * 0.036);
      const marginY = Math.round(shortEdge * 0.032);
      ctx.save();
      ctx.font = `600 ${fontSize}px "Courier New", Menlo, monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.shadowColor = 'rgba(255, 72, 0, 0.72)';
      ctx.shadowBlur = Math.max(4, Math.round(fontSize * 0.25));
      ctx.fillStyle = '#FF6B2B';
      ctx.fillText(dateText, padX + outW - marginX, padTop + outH - marginY);
      ctx.restore();
    }

    // 绘制暗房白边底部的胶卷标识印记
    if (showBorder) {
      const labelSize = Math.max(18, Math.round(shortEdge * 0.024));
      const code = (film && film.code) ? film.code : 'RAW';
      ctx.save();
      ctx.font = `500 ${labelSize}px -apple-system, "PingFang SC", sans-serif`;
      ctx.fillStyle = '#3B3B40';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`SILVERLAB · ${code}`, totalW / 2, padTop + outH + padBottom / 2);
      ctx.restore();
    }

    const dataUrl = canvas2d.toDataURL('image/jpeg', 0.94);
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const outPath = `${wx.env.USER_DATA_PATH}/silverlab_export.jpg`;
    wx.getFileSystemManager().writeFileSync(outPath, base64, 'base64');
    return outPath;
  } finally {
    canvas2d = null;
  }
}

module.exports = {
  VERTEX_SHADER,
  FRAGMENT_SHADER,
  UNIFORM_NAMES,
  FilmRenderer,
  exportHighRes
};
