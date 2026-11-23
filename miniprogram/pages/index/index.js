const { FILMS, DEFAULT_PARAMS } = require('../../config/films');
const { FilmRenderer, exportHighRes } = require('../../utils/film-renderer');

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

// 生成经典胶片石英日期戳字符串（格式：'YY MM DD）
function formatFilmDate(date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  return `'${yy} ${mm} ${dd}`;
}

function formatExposureText(exposure) {
  if (Math.abs(exposure) < 0.01) return '0.0';
  return exposure > 0 ? `+${exposure.toFixed(1)}` : exposure.toFixed(1);
}

// 将归一化渲染参数转换为原生滑块使用的整数 UI 值，避免浮点步进抖动
function paramsToSliderUi(params) {
  return {
    intensity: Math.round((params.intensity || 0) * 100),
    exposure: Math.round((params.exposure || 0) * 10),
    grain: Math.round((params.grain || 0) * 100),
    halation: Math.round((params.halation || 0) * 100),
    vignette: Math.round((params.vignette || 0) * 100)
  };
}

function getDefaultFilmParams(film) {
  return Object.assign({}, DEFAULT_PARAMS, (film && film.defaults) || {});
}

// 计算贴合暗房舞台区域且保持与高清导出 1:1 比例的预览框尺寸
function calcPreviewLayout(photoW, photoH, stageW, stageH, showBorder) {
  const safeW = Math.max(1, photoW || 1080);
  const safeH = Math.max(1, photoH || 1080);
  const availW = Math.max(120, (stageW || 320) - 8);
  const availH = Math.max(120, (stageH || 360) - 8);

  const shortEdge = Math.min(safeW, safeH);
  const w0 = safeW / shortEdge;
  const h0 = safeH / shortEdge;

  const borderX = showBorder ? 0.045 : 0;
  const borderTop = showBorder ? 0.045 : 0;
  const borderBottom = showBorder ? 0.125 : 0;

  const scale = Math.min(availW / (w0 + borderX * 2), availH / (h0 + borderTop + borderBottom));
  const displayW = Math.max(60, Math.round(w0 * scale));
  const displayH = Math.max(60, Math.round(h0 * scale));
  const padX = Math.round(borderX * scale);
  const padTop = Math.round(borderTop * scale);
  const padBottom = Math.round(borderBottom * scale);
  const previewShort = Math.min(displayW, displayH);

  return {
    displayW,
    displayH,
    padX,
    padTop,
    padBottom,
    dateFontSize: Math.max(10, Math.round(previewShort * 0.032)),
    dateMarginX: Math.max(6, Math.round(previewShort * 0.036)),
    dateMarginY: Math.max(6, Math.round(previewShort * 0.032)),
    borderFontSize: Math.max(9, Math.round(previewShort * 0.024))
  };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    capsuleRightOffset: 100,

    hasPhoto: false,
    isExporting: false,
    activeTab: 'film',

    films: FILMS,
    currentFilmId: FILMS[1] ? FILMS[1].id : FILMS[0].id,
    currentFilm: FILMS[1] || FILMS[0],

    showBorder: false,
    showDate: false,
    compareOriginal: false,
    dateText: formatFilmDate(),

    displayW: 280,
    displayH: 360,
    padX: 0,
    padTop: 0,
    padBottom: 0,
    dateFontSize: 12,
    dateMarginX: 12,
    dateMarginY: 10,
    borderFontSize: 10,

    sliderUi: paramsToSliderUi(getDefaultFilmParams(FILMS[1] || FILMS[0])),
    exposureText: formatExposureText(getDefaultFilmParams(FILMS[1] || FILMS[0]).exposure)
  },

  onLoad() {
    this.initSystemLayout();
    const initialFilm = this.data.currentFilm;
    this.params = getDefaultFilmParams(initialFilm);
    this.photoPath = '';
    this.photoWidth = 0;
    this.photoHeight = 0;
    this.stageWidth = 320;
    this.stageHeight = 380;
    this.seed = 1.0;
    this.renderer = null;
    this.canvasNode = null;
  },

  onReady() {
    this.measureStage();
  },

  onShow() {
    // 从后台切回前台时重绘当前帧，防止系统回收绘图缓冲区导致黑屏
    if (this.data.hasPhoto && this.renderer) {
      this.renderFrame();
    }
  },

  onUnload() {
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.canvasNode = null;
  },

  initSystemLayout() {
    let statusBarHeight = 20;
    let windowWidth = 375;
    let dpr = 2;

    if (wx.getWindowInfo) {
      const winInfo = wx.getWindowInfo();
      statusBarHeight = winInfo.statusBarHeight || 20;
      windowWidth = winInfo.windowWidth || 375;
      dpr = winInfo.pixelRatio || 2;
    } else {
      const sysInfo = wx.getSystemInfoSync();
      statusBarHeight = sysInfo.statusBarHeight || 20;
      windowWidth = sysInfo.windowWidth || 375;
      dpr = sysInfo.pixelRatio || 2;
    }

    // 预览像素比上限设为 2，在清晰度与显存占用间保持平衡
    this.dpr = Math.min(Math.max(dpr, 1), 2);

    let navBarHeight = 44;
    let capsuleRightOffset = 100;
    if (wx.getMenuButtonBoundingClientRect) {
      try {
        const rect = wx.getMenuButtonBoundingClientRect();
        if (rect && rect.height) {
          navBarHeight = Math.max(36, (rect.top - statusBarHeight) * 2 + rect.height);
          capsuleRightOffset = Math.max(96, windowWidth - rect.left + 12);
        }
      } catch (err) {
        // 忽略部分调试环境的胶囊读取异常，使用默认值
      }
    }

    this.setData({
      statusBarHeight,
      navBarHeight,
      capsuleRightOffset
    });
  },

  measureStage() {
    return new Promise((resolve) => {
      wx.createSelectorQuery()
        .in(this)
        .select('#stageArea')
        .boundingClientRect((rect) => {
          if (rect && rect.width && rect.height) {
            this.stageWidth = rect.width;
            this.stageHeight = rect.height;
          }
          resolve();
        })
        .exec();
    });
  },

  ensureRenderer() {
    if (this.renderer) {
      return Promise.resolve(this.renderer);
    }
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select('#previewCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const item = res && res[0];
          if (!item || !item.node) {
            reject(new Error('未找到 WebGL 预览画布节点'));
            return;
          }
          try {
            this.canvasNode = item.node;
            this.syncCanvasBufferSize(this.data.displayW, this.data.displayH);
            this.renderer = new FilmRenderer(this.canvasNode);
            resolve(this.renderer);
          } catch (err) {
            reject(err);
          }
        });
    });
  },

  syncCanvasBufferSize(displayW, displayH) {
    if (!this.canvasNode) return;
    const dpr = this.dpr || 2;
    const maxPreviewEdge = 1440;
    let bufW = Math.max(2, Math.round(displayW * dpr));
    let bufH = Math.max(2, Math.round(displayH * dpr));
    const longEdge = Math.max(bufW, bufH);
    if (longEdge > maxPreviewEdge) {
      const scale = maxPreviewEdge / longEdge;
      bufW = Math.max(2, Math.round(bufW * scale));
      bufH = Math.max(2, Math.round(bufH * scale));
    }
    if (this.canvasNode.width !== bufW) {
      this.canvasNode.width = bufW;
    }
    if (this.canvasNode.height !== bufH) {
      this.canvasNode.height = bufH;
    }
  },

  renderFrame() {
    if (!this.renderer || !this.photoPath) return;
    this.renderer.render(this.params, {
      flipY: false,
      compareOriginal: this.data.compareOriginal,
      seed: this.seed
    });
  },

  onChoosePhoto() {
    wx.showActionSheet({
      itemList: ['从相册选择', '直接拍摄'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.pickImage('album');
        } else if (res.tapIndex === 1) {
          this.pickImage('camera');
        }
      }
    });
  },

  onChooseFromAlbum() {
    this.pickImage('album');
  },

  onTakePhoto() {
    this.pickImage('camera');
  },

  pickImage(sourceType) {
    const onSelected = (tempFilePath) => {
      if (!tempFilePath) return;
      this.loadSelectedPhoto(tempFilePath);
    };

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: [sourceType],
        sizeType: ['original', 'compressed'],
        success: (res) => {
          const file = res.tempFiles && res.tempFiles[0];
          onSelected(file && file.tempFilePath);
        }
      });
      return;
    }

    wx.chooseImage({
      count: 1,
      sourceType: [sourceType],
      sizeType: ['original', 'compressed'],
      success: (res) => {
        onSelected(res.tempFilePaths && res.tempFilePaths[0]);
      }
    });
  },

  async loadSelectedPhoto(tempFilePath) {
    wx.showLoading({ title: '读取照片...', mask: true });
    try {
      await this.measureStage();
      // 用 getImageInfo 读取 EXIF 纠正后的真实显示宽高，提前算好画布容器比例
      const info = await new Promise((resolve, reject) => {
        wx.getImageInfo({
          src: tempFilePath,
          success: resolve,
          fail: reject
        });
      });

      this.photoPath = tempFilePath;
      this.photoWidth = info.width || 1080;
      this.photoHeight = info.height || 1080;
      this.seed = Math.round(Math.random() * 1000) / 100;

      const layout = calcPreviewLayout(
        this.photoWidth,
        this.photoHeight,
        this.stageWidth,
        this.stageHeight,
        this.data.showBorder
      );

      await new Promise((resolve) => {
        this.setData(Object.assign({ hasPhoto: true, compareOriginal: false }, layout), resolve);
      });

      const renderer = await this.ensureRenderer();
      this.syncCanvasBufferSize(layout.displayW, layout.displayH);

      const decodedSize = await renderer.setPhoto(tempFilePath);
      if (decodedSize && decodedSize.width && decodedSize.height) {
        this.photoWidth = decodedSize.width;
        this.photoHeight = decodedSize.height;
      }

      const film = this.data.currentFilm;
      await renderer.setLut(film.lutPath, film.lutSize || 33);
      this.renderFrame();
    } catch (err) {
      wx.showToast({
        title: '照片加载失败',
        icon: 'none'
      });
    } finally {
      wx.hideLoading();
    }
  },

  async onSelectFilm(e) {
    const filmId = e.currentTarget.dataset.id;
    const film = FILMS.find((item) => item.id === filmId);
    if (!film) return;

    const nextParams = getDefaultFilmParams(film);
    this.params = nextParams;

    this.setData({
      currentFilmId: film.id,
      currentFilm: film,
      compareOriginal: false,
      sliderUi: paramsToSliderUi(nextParams),
      exposureText: formatExposureText(nextParams.exposure)
    });

    if (this.data.hasPhoto && this.renderer) {
      try {
        await this.renderer.setLut(film.lutPath, film.lutSize || 33);
        this.renderFrame();
      } catch (err) {
        wx.showToast({ title: '胶卷加载失败', icon: 'none' });
      }
    }
  },

  onSwitchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab && tab !== this.data.activeTab) {
      this.setData({ activeTab: tab });
    }
  },

  updateParamFromSlider(key, rawValue, syncUiText) {
    const value = Number(rawValue);
    const normalized = key === 'exposure' ? value / 10 : value / 100;
    this.params[key] = normalized;

    if (this.data.hasPhoto && this.renderer) {
      if (this.data.compareOriginal) {
        this.setData({ compareOriginal: false }, () => this.renderFrame());
      } else {
        this.renderFrame();
      }
    }

    if (syncUiText) {
      const update = {};
      update[`sliderUi.${key}`] = value;
      if (key === 'exposure') {
        update.exposureText = formatExposureText(normalized);
      }
      this.setData(update);
    }
  },

  onSliderChanging(e) {
    const key = e.currentTarget.dataset.key;
    this.updateParamFromSlider(key, e.detail.value, true);
  },

  onSliderChange(e) {
    const key = e.currentTarget.dataset.key;
    this.updateParamFromSlider(key, e.detail.value, true);
  },

  onResetParams() {
    const nextParams = getDefaultFilmParams(this.data.currentFilm);
    this.params = nextParams;
    this.setData({
      compareOriginal: false,
      sliderUi: paramsToSliderUi(nextParams),
      exposureText: formatExposureText(nextParams.exposure)
    });
    if (this.data.hasPhoto && this.renderer) {
      this.renderFrame();
    }
  },

  onToggleBorder() {
    const showBorder = !this.data.showBorder;
    if (!this.data.hasPhoto) {
      this.setData({ showBorder });
      return;
    }
    const layout = calcPreviewLayout(
      this.photoWidth,
      this.photoHeight,
      this.stageWidth,
      this.stageHeight,
      showBorder
    );
    this.setData(Object.assign({ showBorder }, layout), () => {
      this.syncCanvasBufferSize(layout.displayW, layout.displayH);
      this.renderFrame();
    });
  },

  onToggleDate() {
    this.setData({ showDate: !this.data.showDate });
  },

  onToggleCompare() {
    if (!this.data.hasPhoto) return;
    this.setData({ compareOriginal: !this.data.compareOriginal }, () => {
      this.renderFrame();
    });
  },

  onCompareStart() {
    if (!this.data.hasPhoto || this.data.compareOriginal) return;
    this.setData({ compareOriginal: true }, () => {
      this.renderFrame();
    });
  },

  onCompareEnd() {
    if (!this.data.hasPhoto || !this.data.compareOriginal) return;
    this.setData({ compareOriginal: false }, () => {
      this.renderFrame();
    });
  },

  async onSavePhoto() {
    if (!this.data.hasPhoto || this.data.isExporting) return;

    this.setData({ isExporting: true });
    wx.showLoading({ title: '暗房冲印中...', mask: true });

    try {
      const exportedPath = await exportHighRes({
        photoPath: this.photoPath,
        photoWidth: this.photoWidth,
        photoHeight: this.photoHeight,
        film: this.data.currentFilm,
        params: this.params,
        showBorder: this.data.showBorder,
        showDate: this.data.showDate,
        dateText: this.data.dateText,
        seed: this.seed,
        maxEdge: 2048
      });

      await this.saveFileToAlbum(exportedPath);
      wx.showToast({
        title: '已保存到相册',
        icon: 'success'
      });
    } catch (err) {
      if (!err || err.errMsg !== 'auth_guide_shown') {
        wx.showToast({
          title: '保存失败，请重试',
          icon: 'none'
        });
      }
    } finally {
      wx.hideLoading();
      this.setData({ isExporting: false });
    }
  },

  saveFileToAlbum(filePath) {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: resolve,
        fail: (err) => {
          const msg = (err && err.errMsg) || '';
          if (msg.includes('auth deny') || msg.includes('auth denied') || msg.includes('authorize')) {
            wx.hideLoading();
            wx.showModal({
              title: '需要相册权限',
              content: '请在设置中允许保存到相册，以便导出冲印成片。',
              confirmText: '去开启',
              cancelText: '取消',
              success: (modalRes) => {
                if (modalRes.confirm) {
                  wx.openSetting();
                }
                reject({ errMsg: 'auth_guide_shown' });
              },
              fail: () => reject(err)
            });
            return;
          }
          reject(err);
        }
      });
    });
  }
});
