/* 项目自动校验与引擎指标验收：node tests.js 运行，失败退出码 1 */
const fs = require('fs');
let src = fs.readFileSync('js/core.js', 'utf8');
const pre = 'global.localStorage={getItem:()=>null,setItem:()=>{}};global.Image=function(){};global.document={createElement:()=>({appendChild:()=>{},classList:{add:()=>{},remove:()=>{}}}),body:{appendChild:()=>{}}};';
const { QUESTIONS, DIMS, FIGURES, Store, DIM_STATS } = new Function(pre + src + ';return {QUESTIONS,DIMS,FIGURES,Store,DIM_STATS};')();
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : '')); if (!ok) failed++; };

/* ---- 题库结构 ---- */
check('题量 = 24', QUESTIONS.length === 24, '实际 ' + QUESTIONS.length);
const cats = [...new Set(QUESTIONS.map(q => q.cat))];
check('模块数 = 6', cats.length === 6, cats.join('/'));
check('每题 4 选项', QUESTIONS.every(q => q.o.length === 4));
check('权重维度均在八维内', QUESTIONS.every(q => q.o.every(o => Object.keys(o[1]).every(k => DIMS.includes(k)))));
check('选项权重均在 1-3', QUESTIONS.every(q => q.o.every(o => Object.values(o[1]).every(v => v >= 1 && v <= 3))));
check('每题题干非空', QUESTIONS.every(q => q.q && q.q.length >= 6));

/* ---- 人物库结构 ---- */
check('人物数 = 28', FIGURES.length === 28, '实际 ' + FIGURES.length);
check('id 唯一', new Set(FIGURES.map(f => f.id)).size === FIGURES.length);
const FIELDS = ['id','name','dynasty','gender','region','tags','scores','quote','opener','intro','self_portrait','base_color','interaction','blind_spot','risk','suggestion','summary3'];
check('每人 15+ 字段齐全', FIGURES.every(f => FIELDS.every(k => f[k] !== undefined && f[k] !== null)));
check('gender 取值合法', FIGURES.every(f => f.gender === '男' || f.gender === '女'));
check('region 取值合法', FIGURES.every(f => f.region === 'cn' || f.region === 'ov'));
check('八维基准分均为 0-100 整数', FIGURES.every(f => f.scores.length === 8 && f.scores.every(v => Number.isInteger(v) && v >= 0 && v <= 100)));
const gcnt = g => FIGURES.filter(f => f.gender === g).length;
check('男 >= 10 人', gcnt('男') >= 10, '实际 ' + gcnt('男'));
check('女 >= 10 人', gcnt('女') >= 10, '实际 ' + gcnt('女'));
check('中国 >= 10 人', FIGURES.filter(f => f.region === 'cn').length >= 10);
check('外国 >= 5 人（认知度优先决策）', FIGURES.filter(f => f.region === 'ov').length >= 5, '实际 ' + FIGURES.filter(f => f.region === 'ov').length);

/* ---- 引擎冒烟 ---- */
QUESTIONS.forEach((q, i) => Store.data.answers[i] = i % 4);
Store.data.gender = null;
check('随机作答可完成匹配', Store.computeMatch() && Store.getFigure(Store.data.matchId) !== null);
check('匹配度在 55-99', Store.data.matchPct >= 55 && Store.data.matchPct <= 99, '实际 ' + Store.data.matchPct);

/* ---- 引擎层指标（5 万次模拟） ---- */
const N = 50000;
const hits = {}, pcts = [], topGaps = [], zstd = {};
DIMS.forEach(d => zstd[d] = []);
const poolAll = Store.pool();
const fm = {}, fss = {};
DIMS.forEach((d, i) => {
  const vals = poolAll.map(f => f.scores[i]);
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  fm[d] = m;
  fss[d] = Math.sqrt(vals.reduce((a, b) => a + (b - m) * (b - m), 0) / vals.length) || 1;
});
for (let i = 0; i < N; i++) {
  Store.data.answers = {};
  QUESTIONS.forEach((q, qi) => Store.data.answers[qi] = Math.floor(Math.random() * 4));
  const raw = {}; DIMS.forEach(d => raw[d] = 0);
  QUESTIONS.forEach((q, qi) => { const w = (q.o[Store.data.answers[qi]] || [])[1] || {}; for (const k in w) raw[k] += w[k]; });
  const zu = {}; DIMS.forEach(d => { zstd[d].push((raw[d] - DIM_STATS.mu[d]) / DIM_STATS.sd[d]); zu[d] = zstd[d][zstd[d].length - 1]; });
  const ranked = poolAll.map(f => { let mad = 0; DIMS.forEach((d, i) => mad += Math.abs(zu[d] - (f.scores[i] - fm[d]) / fss[d])); mad /= 8; return { f, mad }; }).sort((a, b) => a.mad - b.mad);
  hits[ranked[0].f.id] = (hits[ranked[0].f.id] || 0) + 1;
  topGaps.push(ranked[1].mad - ranked[0].mad);
  pcts.push(Math.round(100 - ranked[0].mad * 38));
}
pcts.sort((a, b) => a - b); topGaps.sort((a, b) => a - b);
const ent = -Object.values(hits).map(v => v / N).reduce((a, p) => a + p * Math.log2(p), 0);
const hottest = Math.max(...Object.values(hits)) / N;
const avgGap = topGaps.reduce((a, b) => a + b, 0) / N;
const med = pcts[Math.floor(N / 2)], p95 = pcts[Math.floor(N * 0.95)];
const zs = DIMS.map(d => { const v = zstd[d]; const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length); });
const minZstd = Math.min(...zs);

check('命中熵 >= 4.2', ent >= 4.2, '实际 ' + ent.toFixed(2) + '（上限 ' + Math.log2(FIGURES.length).toFixed(2) + '）');
check('最热人物占比 <= 15%', hottest <= 0.15, '实际 ' + (hottest * 100).toFixed(1) + '%');
check('28 位人物全部可命中', Object.keys(hits).length === FIGURES.length, '实际 ' + Object.keys(hits).length);
check('Top1/Top2 平均距离差 >= 0.05（目标 0.1）', avgGap >= 0.05, '实际 ' + avgGap.toFixed(3));
check('匹配度中位数 55-80', med >= 55 && med <= 80, '实际 ' + med + '%');
check('95 分位 <= 90', p95 <= 90, '实际 ' + p95 + '%');
check('八维 z 标准差均 >= 0.8', minZstd >= 0.8, '最低维度 ' + minZstd.toFixed(2));
check('埋点字段就绪', typeof Store.data.stats.completed === 'number' && typeof Store.data.stats.shared === 'number');

console.log('----');
console.log('结果：' + (failed === 0 ? '全部通过' : failed + ' 项失败'));
process.exit(failed === 0 ? 0 : 1);