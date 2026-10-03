/* 静态资料表：群系 ID / 中文名 / 兜底配色，建筑定义 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  // cubiomes 群系 ID（与引擎调色板下标一致，兜底引擎直接复用同一套配色）
  MC.BIOME_IDS = {
    ocean: 0, plains: 1, desert: 2, windswept_hills: 3, forest: 4, taiga: 5, swamp: 6,
    river: 7, nether_wastes: 8, the_end: 9, frozen_ocean: 10, frozen_river: 11,
    snowy_plains: 12, snowy_mountains: 13, mushroom_fields: 14, mushroom_field_shore: 15,
    beach: 16, desert_hills: 17, wooded_hills: 18, taiga_hills: 19, mountain_edge: 20,
    jungle: 21, jungle_hills: 22, sparse_jungle: 23, deep_ocean: 24, stony_shore: 25,
    snowy_beach: 26, birch_forest: 27, birch_forest_hills: 28, dark_forest: 29,
    snowy_taiga: 30, snowy_taiga_hills: 31, old_growth_pine_taiga: 32, giant_tree_taiga_hills: 33,
    windswept_forest: 34, savanna: 35, savanna_plateau: 36, badlands: 37, wooded_badlands: 38,
    badlands_plateau: 39, small_end_islands: 40, end_midlands: 41, end_highlands: 42,
    end_barrens: 43, warm_ocean: 44, lukewarm_ocean: 45, cold_ocean: 46, deep_warm_ocean: 47,
    deep_lukewarm_ocean: 48, deep_cold_ocean: 49, deep_frozen_ocean: 50, the_void: 127,
    sunflower_plains: 129, desert_lakes: 130, windswept_gravelly_hills: 131, flower_forest: 132,
    taiga_mountains: 133, swamp_hills: 134, ice_spikes: 140, modified_jungle: 149,
    modified_jungle_edge: 151, old_growth_birch_forest: 155, tall_birch_hills: 156,
    dark_forest_hills: 157, snowy_taiga_mountains: 158, old_growth_spruce_taiga: 160,
    giant_spruce_taiga_hills: 161, modified_gravelly_mountains: 162, windswept_savanna: 163,
    shattered_savanna_plateau: 164, eroded_badlands: 165, modified_wooded_badlands_plateau: 166,
    modified_badlands_plateau: 167, bamboo_jungle: 168, bamboo_jungle_hills: 169,
    soul_sand_valley: 170, crimson_forest: 171, warped_forest: 172, basalt_deltas: 173,
    dripstone_caves: 174, lush_caves: 175, meadow: 177, grove: 178, snowy_slopes: 179,
    jagged_peaks: 180, frozen_peaks: 181, stony_peaks: 182, deep_dark: 183,
    mangrove_swamp: 184, cherry_grove: 185, pale_garden: 186
  };

  MC.BIOME_ZH = {
    ocean: '海洋', plains: '平原', desert: '沙漠', windswept_hills: '风袭丘陵', forest: '森林',
    taiga: '针叶林', swamp: '沼泽', river: '河流', nether_wastes: '下界荒地', the_end: '末地',
    frozen_ocean: '冰冻海洋', frozen_river: '冰冻河流', snowy_plains: '雪原',
    snowy_mountains: '雪山', mushroom_fields: '蘑菇岛', mushroom_field_shore: '蘑菇岛岸',
    beach: '沙滩', desert_hills: '沙漠丘陵', wooded_hills: '林木丘陵', taiga_hills: '针叶林丘陵',
    mountain_edge: '山地边缘', jungle: '丛林', jungle_hills: '丛林丘陵', sparse_jungle: '稀疏丛林',
    deep_ocean: '深海', stony_shore: '石岸', snowy_beach: '雪滩', birch_forest: '白桦森林',
    birch_forest_hills: '白桦森林丘陵', dark_forest: '黑森林', snowy_taiga: '雪地针叶林',
    snowy_taiga_hills: '雪地针叶林丘陵', old_growth_pine_taiga: '原始松木针叶林',
    giant_tree_taiga_hills: '巨型针叶林丘陵', windswept_forest: '风袭森林', savanna: '热带草原',
    savanna_plateau: '热带高原', badlands: '恶地', wooded_badlands: '林木恶地',
    badlands_plateau: '恶地高原', small_end_islands: '末地小岛', end_midlands: '末地内陆',
    end_highlands: '末地高地', end_barrens: '末地荒地', warm_ocean: '温暖海洋',
    lukewarm_ocean: '温和海洋', cold_ocean: '寒冷海洋', deep_warm_ocean: '深海（暖）',
    deep_lukewarm_ocean: '深海（温）', deep_cold_ocean: '深海（寒）', deep_frozen_ocean: '深海（冻）',
    the_void: '虚空', sunflower_plains: '向日葵平原', desert_lakes: '沙漠湖泊',
    windswept_gravelly_hills: '风袭沙砾丘陵', flower_forest: '繁花森林', taiga_mountains: '针叶林山地',
    swamp_hills: '沼泽丘陵', ice_spikes: '冰刺之地', modified_jungle: '丛林（变体）',
    modified_jungle_edge: '丛林边缘（变体）', old_growth_birch_forest: '原始白桦森林',
    tall_birch_hills: '高白桦丘陵', dark_forest_hills: '黑森林丘陵',
    snowy_taiga_mountains: '雪地针叶林山地', old_growth_spruce_taiga: '原始云杉针叶林',
    giant_spruce_taiga_hills: '巨型云杉丘陵', modified_gravelly_mountains: '沙砾山地（变体）',
    windswept_savanna: '风袭热带草原', shattered_savanna_plateau: '破碎的热带高原',
    eroded_badlands: '风蚀恶地', modified_wooded_badlands_plateau: '林木恶地高原（变体）',
    modified_badlands_plateau: '恶地高原（变体）', bamboo_jungle: '竹林',
    bamboo_jungle_hills: '竹林丘陵', soul_sand_valley: '灵魂沙峡谷', crimson_forest: '绯红森林',
    warped_forest: '诡异森林', basalt_deltas: '玄武岩三角洲', dripstone_caves: '滴水石洞穴',
    lush_caves: '繁茂洞穴', meadow: '草甸', grove: '树林', snowy_slopes: '积雪斜坡',
    jagged_peaks: '尖峭山峰', frozen_peaks: '冰封山峰', stony_peaks: '石峰', deep_dark: '深暗之域',
    mangrove_swamp: '红树林沼泽', cherry_grove: '樱花林', pale_garden: '苍白花园'
  };

  // 兜底配色（WASM 不可用时），数值贴近官方地图观感
  MC.BIOME_COLORS = {
    ocean: '#3c6ee0', deep_ocean: '#1e3f9c', frozen_ocean: '#7c8ce0', river: '#4a7ef0',
    frozen_river: '#a0b8ff', beach: '#f2e08a', snowy_beach: '#faf0e0', stony_shore: '#a2a284',
    plains: '#8db360', sunflower_plains: '#b5d45c', desert: '#f6a623', desert_lakes: '#f6b45c',
    desert_hills: '#d99124', savanna: '#bdb25f', savanna_plateau: '#a79d64', windswept_savanna: '#b9ad63',
    forest: '#0f6b2f', flower_forest: '#2d8a3e', birch_forest: '#5f8f3a', dark_forest: '#2a4f1f',
    old_growth_birch_forest: '#4f7a2e', taiga: '#0b6b4f', snowy_taiga: '#1c6b5e',
    old_growth_pine_taiga: '#0a5c46', old_growth_spruce_taiga: '#0a5c46', taiga_mountains: '#0b5f4a',
    snowy_plains: '#dfe8e8', ice_spikes: '#b6dcf0', snowy_mountains: '#c8d4d4',
    snowy_slopes: '#e2ecec', grove: '#6f8f5f', snowy_taiga_mountains: '#2a6b5f',
    jungle: '#1f7a1f', sparse_jungle: '#2f8f2f', bamboo_jungle: '#6fb43a', jungle_hills: '#2a6b23',
    modified_jungle: '#1b6b1b', swamp: '#3f7f5f', mangrove_swamp: '#2f6f4f', swamp_hills: '#3a6f55',
    badlands: '#d94515', eroded_badlands: '#f08030', wooded_badlands: '#b04020',
    badlands_plateau: '#c8501e', mushroom_fields: '#a00f8f', mushroom_field_shore: '#8a0f7a',
    windswept_hills: '#7f8f7f', windswept_gravelly_hills: '#9a9a9a', windswept_forest: '#5f7f4f',
    mountain_edge: '#7f8f8f', taiga_hills: '#0b6b4f', wooded_hills: '#2f6b2f',
    meadow: '#7fbf5f', cherry_grove: '#f5b8d0', jagged_peaks: '#c0c8d0', frozen_peaks: '#e0f0ff',
    stony_peaks: '#b0b0a0', the_void: '#000000', the_end: '#8080a0', end_midlands: '#c0c0a0',
    end_highlands: '#e0e0c0', end_barrens: '#a0a090', small_end_islands: '#909090',
    nether_wastes: '#6b2b2b', soul_sand_valley: '#4a3020', crimson_forest: '#8a1b1b',
    warped_forest: '#1b6b6b', basalt_deltas: '#40404a', warm_ocean: '#4fd0d0',
    lukewarm_ocean: '#4fa8d8', cold_ocean: '#3f80c0', deep_warm_ocean: '#2fb0b0',
    deep_lukewarm_ocean: '#2f88c0', deep_cold_ocean: '#2f60a0', deep_frozen_ocean: '#4f70c0',
    dripstone_caves: '#7a5f3f', lush_caves: '#3f8f3f', deep_dark: '#1a1a2a', pale_garden: '#cfd6c0'
  };

  /**
   * 建筑定义。
   * engine: cubiomes 中对应的结构名（运行时按名取枚举下标，取不到则该版本不支持）
   * 位置一律由 cubiomes 计算；近似引擎不提供结构，见 jsBackend.regionSize。
   */
  MC.STRUCTURES = [
    { key: 'village', zh: '村庄', mark: '村', color: '#b07a35', dim: 0, engine: 'village' },
    { key: 'desert_pyramid', zh: '沙漠神殿', mark: '殿', color: '#d9a441', dim: 0, engine: 'desert_pyramid' },
    { key: 'jungle_pyramid', zh: '丛林神庙', mark: '庙', color: '#7fae52', dim: 0, engine: 'jungle_pyramid' },
    { key: 'swamp_hut', zh: '沼泽小屋', mark: '屋', color: '#4f7a5f', dim: 0, engine: 'swamp_hut' },
    { key: 'igloo', zh: '冰屋', mark: '冰', color: '#9fd4e8', dim: 0, engine: 'igloo' },
    { key: 'pillager_outpost', zh: '掠夺者前哨站', mark: '哨', color: '#6b6b7a', dim: 0, engine: 'pillager_outpost' },
    { key: 'mansion', zh: '林地府邸', mark: '邸', color: '#4a3b2a', dim: 0, engine: 'mansion' },
    { key: 'monument', zh: '海底神殿', mark: '碑', color: '#3f8fa8', dim: 0, engine: 'monument' },
    { key: 'ocean_ruin', zh: '海底废墟', mark: '墟', color: '#5f8f9f', dim: 0, engine: 'ocean_ruin' },
    { key: 'shipwreck', zh: '沉船', mark: '船', color: '#8a6a4a', dim: 0, engine: 'shipwreck' },
    { key: 'ruined_portal', zh: '废弃传送门', mark: '门', color: '#7a5fbf', dim: 0, engine: 'ruined_portal' },
    { key: 'mineshaft', zh: '废弃矿井', mark: '矿', color: '#8a7a5a', dim: 0, engine: 'mineshaft' },
    { key: 'desert_well', zh: '沙漠水井', mark: '井', color: '#c9b47a', dim: 0, engine: 'desert_well' },
    { key: 'buried_treasure', zh: '埋藏的宝藏', mark: '宝', color: '#d4b106', dim: 0, engine: 'buried_treasure' },
    { key: 'amethyst_geode', zh: '紫水晶洞', mark: '晶', color: '#a06fd0', dim: 0, engine: 'amethyst_geode' },
    { key: 'ancient_city', zh: '远古城市', mark: '城', color: '#2f4f6b', dim: 0, engine: 'ancient_city' },
    { key: 'trail_ruins', zh: '古迹废墟', mark: '迹', color: '#9a8f6b', dim: 0, engine: 'trail_ruins' },
    { key: 'trial_chambers', zh: '试炼密室', mark: '炼', color: '#8f6b4a', dim: 0, engine: 'trial_chambers' },
    { key: 'fortress', zh: '下界要塞', mark: '堡', color: '#8a3b3b', dim: -1, engine: 'fortress' },
    { key: 'bastion_remnant', zh: '堡垒遗迹', mark: '垒', color: '#5f4a3a', dim: -1, engine: 'bastion_remnant' },
    { key: 'ruined_portal_nether', zh: '废弃传送门（下界）', mark: '门', color: '#7a5fbf', dim: -1, engine: 'ruined_portal_nether' },
    { key: 'end_city', zh: '末地城', mark: '末', color: '#c0b090', dim: 1, engine: 'end_city' },
    { key: 'end_gateway', zh: '末地折跃门', mark: '跃', color: '#e0d0a0', dim: 1, engine: 'end_gateway' }
  ];

  MC.structureByKey = function (key) {
    for (var i = 0; i < MC.STRUCTURES.length; i++) {
      if (MC.STRUCTURES[i].key === key) return MC.STRUCTURES[i];
    }
    return null;
  };

  /** 兜底调色板：id → [r,g,b]，未收录群系用灰色 */
  MC.fallbackPalette = function () {
    var pal = new Uint8Array(256 * 3);
    for (var i = 0; i < 256; i++) { pal[i * 3] = 120; pal[i * 3 + 1] = 120; pal[i * 3 + 2] = 120; }
    Object.keys(MC.BIOME_IDS).forEach(function (name) {
      var hex = MC.BIOME_COLORS[name];
      if (!hex) return;
      var id = MC.BIOME_IDS[name];
      pal[id * 3] = parseInt(hex.slice(1, 3), 16);
      pal[id * 3 + 1] = parseInt(hex.slice(3, 5), 16);
      pal[id * 3 + 2] = parseInt(hex.slice(5, 7), 16);
    });
    return pal;
  };
})(globalThis.MC);
