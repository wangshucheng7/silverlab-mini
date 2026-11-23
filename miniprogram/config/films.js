// 默认暗房调节参数
const DEFAULT_PARAMS = {
  intensity: 1.0,
  exposure: 0.0,
  grain: 0.22,
  halation: 0.12,
  vignette: 0.15
};

// 胶卷列表：均采用非商标通用代号；isPro 字段预留给 v1.1 接入微信激励视频广告 wx.createRewardedVideoAd 解锁
const FILMS = [
  {
    id: 'original',
    code: 'RAW',
    name: '原片直出',
    tag: '无滤镜',
    accent: '#6E6E78',
    lutPath: '',
    lutSize: 33,
    isPro: false,
    defaults: {
      intensity: 0.0,
      exposure: 0.0,
      grain: 0.0,
      halation: 0.0,
      vignette: 0.0
    }
  },
  {
    id: 'p400',
    code: 'P400',
    name: '暖柔人像',
    tag: '35mm 负片',
    accent: '#E29E57',
    lutPath: '/assets/luts/p400.png',
    lutSize: 33,
    isPro: false,
    defaults: {
      intensity: 1.0,
      exposure: 0.0,
      grain: 0.20,
      halation: 0.10,
      vignette: 0.14
    }
  },
  {
    id: 'g200',
    code: 'G200',
    name: '阳光复古',
    tag: '日常负片',
    accent: '#D9A73E',
    lutPath: '/assets/luts/g200.png',
    lutSize: 33,
    isPro: false,
    defaults: {
      intensity: 1.0,
      exposure: 0.0,
      grain: 0.26,
      halation: 0.14,
      vignette: 0.16
    }
  },
  {
    id: 'v50d',
    code: 'V50D',
    name: '日光电影',
    tag: '电影负片',
    accent: '#5C8D73',
    lutPath: '/assets/luts/v50d.png',
    lutSize: 33,
    isPro: false,
    defaults: {
      intensity: 1.0,
      exposure: 0.0,
      grain: 0.18,
      halation: 0.16,
      vignette: 0.18
    }
  },
  {
    id: 'v500t',
    code: 'V500T',
    name: '夜景蓝调',
    tag: '灯光电影',
    accent: '#4D7BA8',
    lutPath: '/assets/luts/v500t.png',
    lutSize: 33,
    isPro: false,
    defaults: {
      intensity: 1.0,
      exposure: 0.0,
      grain: 0.32,
      halation: 0.36,
      vignette: 0.20
    }
  },
  {
    id: 'f400h',
    code: 'F400H',
    name: '日系清透',
    tag: '专业负片',
    accent: '#68A89A',
    lutPath: '/assets/luts/f400h.png',
    lutSize: 33,
    isPro: false,
    defaults: {
      intensity: 1.0,
      exposure: 0.0,
      grain: 0.22,
      halation: 0.10,
      vignette: 0.12
    }
  },
  {
    id: 'e100',
    code: 'E100',
    name: '鲜艳街拍',
    tag: '细颗粒负片',
    accent: '#D6523C',
    lutPath: '/assets/luts/e100.png',
    lutSize: 33,
    isPro: false,
    defaults: {
      intensity: 1.0,
      exposure: 0.0,
      grain: 0.14,
      halation: 0.12,
      vignette: 0.16
    }
  }
];

module.exports = {
  DEFAULT_PARAMS,
  FILMS
};
