// 遊戲資料:類股、棋盤格、事件卡、命運牌、數值常數。board.mjs(畫面)和 sim.mjs(模擬 / 電腦 AI)共用,
// 所以這裡不能碰 DOM。L(en, zh) 是語言函式、fmt 是數字格式,由呼叫端傳進來(Node 跑模擬時隨便給)。
export function gameData(L, fmt) {
const SECTORS = {
  tech:   { name: L('Meow Tech', '喵科技'),       code: L('TECH', '科技股'),   color: 0x8b7cff, css: '#7d6cf0', open: 120, div: 0.01, blurb: L('Fast growth, big swings.', '成長快,波動也大。') },
  soft:    { name: L('Hop Bunny Software', '跳跳兔軟體'), code: L('SOFTWARE', '軟體股'), color: 0x5fb3f5, css: '#3f97db', open: 95, div: 0.005, blurb: L('Subscriptions keep profits growing, but high valuations fall hard when rates rise.', '訂閱制讓獲利穩定成長;但估值高,升息時跌得特別多。') },
  chip:   { name: L('Paw Chips', '貓掌半導體'),   code: L('CHIPS', '半導體'),  color: 0x4f8ef0, css: '#3f7de0', open: 90,  div: 0.01, blurb: L('Booms and busts with supply.', '跟著供需循環大起大落。') },
  robot:   { name: L('Octopus Robotics', '章魚機器人'), code: L('ROBOTICS', '機器人'), color: 0x5c7080, css: '#4f6373', open: 90,  div: 0.005, blurb: L('Factory robots and automation. Wins when workers are scarce and factories move home; firms cut this spending first in a slump.', '工業機器人和自動化。缺工、工廠搬回本國時受惠;景氣差時,企業最先砍的就是設備投資。') },
  yield:   { name: L('Sloth Telecom', '樹懶電信'),   code: L('TELECOM', '電信股'),  color: 0xf5b942, css: '#d99a12', open: 60,  div: 0.05, blurb: L('Everyone pays the phone bill in good times and bad. Slow mover, but a high dividend.', '景氣好壞大家都要繳電話費。漲得慢,但配息高。') },
  oil:     { name: L('Camel Energy', '駱駝能源'),   code: L('ENERGY', '能源股'), color: 0xf2796b, css: '#e2604f', open: 80,  div: 0.02, blurb: L('Moves with world events.', '跟著國際事件走。') },
  health:  { name: L('Penguin Health', '企鵝醫療'), code: L('HEALTH', '醫療股'), color: 0x54c98a, css: '#35ad6d', open: 70,  div: 0.02, blurb: L('Steady when markets panic.', '市場恐慌時相對抗跌。') },
  reit:    { name: L('Beaver REIT', '海狸不動產'), code: L('REIT', '不動產'), color: 0xc48ad6, css: '#ad6cc4', open: 100, div: 0.04, blurb: L('A high dividend. Hates rate hikes.', '配息高,最怕升息。') },
  fin:     { name: L('Squirrel Bank', '松鼠金控'),       code: L('FINANCE', '金融股'),  color: 0x2a9db5, css: '#1f8aa1', open: 85,  div: 0.03, blurb: L('Likes higher rates. Pays a steady dividend.', '升息時受惠,配息穩定。') },
  trans:   { name: L('Cheetah Shipping', '獵豹航運'), code: L('TRANSPORT', '運輸股'), color: 0x9a7b66, css: '#86654f', open: 75,  div: 0.02, blurb: L('Shipping and airlines: hurt by fuel costs, lifted by trade and travel booms.', '航運和航空:油價漲就受傷,運價漲、旅遊旺就大賺。') },
  bio:    { name: L('Catnip Bio', '貓草生技'),       code: L('BIOTECH', '生技股'),  color: 0xe85d9b, css: '#d44a88', open: 110, div: 0,    blurb: L('No dividends. Drug news makes it soar or crash.', '不配息,新藥消息決定大漲或大跌。') },
  staples: { name: L('Hamster Foods', '倉鼠食品'),      code: L('STAPLES', '民生消費'), color: 0x7fb069, css: '#62964b', open: 65,  div: 0.03, blurb: L('People buy food in any economy. Falls least in a panic.', '景氣再差也要吃飯,恐慌時跌最少。') },
  disc:    { name: L('Seagull Travel', '海鷗旅遊'),   code: L('LEISURE', '觀光餐飲'), color: 0xff8c69, css: '#ef6f48', open: 85,  div: 0.01, blurb: L('People spend here only when times are good.', '有閒錢才會花,景氣好壞差很多。') },
  ecom:    { name: L('Otter Shop', '水獺電商'), code: L('E-COMMERCE', '電商零售'), color: 0xff7a45, css: '#e8642c', open: 85,  div: 0.005, blurb: L('Online shops and retail chains. Booms when people feel rich enough to spend; shipping and ad costs bite.', '網購和零售通路。大家敢花錢時賺最多;物流和廣告成本是負擔。') },
  util:    { name: L('Eel Power', '電鰻電力'),     code: L('UTILITY', '公用事業'), color: 0x5c7cba, css: '#4a69a8', open: 55,  div: 0.04, blurb: L('Boring and steady, with a high dividend.', '無聊但穩定,配息高。') },
  mat:     { name: L('Rhino Steel', '犀牛鋼鐵'),     code: L('MATERIALS', '原物料'), color: 0x8a8f98, css: '#6f757f', open: 70,  div: 0.02, blurb: L('Rises with inflation and building booms.', '跟著通膨和景氣走。') },
  agri:    { name: L('Dairy Cow Farms', '乳牛農產'),  code: L('AGRI', '農產品'),   color: 0xa3c45a, css: '#7fa33a', open: 60,  div: 0.02, blurb: L('Grain, meat and milk. Moves with inflation, weather and war, not with the stock market.', '穀物、肉、奶。跟著通膨、天氣和戰爭走,跟股市關聯不大。') },
  gold:    { name: L('Goldfish Gold', '金魚黃金'),         code: L('GOLD', '黃金'),       color: 0xe6b422, css: '#c4950c', open: 100, div: 0,    blurb: L('A safe haven. Rises when markets panic.', '避險資產,市場恐慌時反而上漲。') },
  bond:    { name: L('Tortoise Bond', '烏龜債券'),          code: L('BOND', '債券'),       color: 0x6aa5a9, css: '#4f8c90', open: 100, div: 0.03, blurb: L('Up when rates fall, down when they rise.', '降息漲、升息跌,和股票互補。') },
  etf:     { name: L('Zoo ETF', '動物園 ETF'), code: L('ETF', '大盤ETF'),     color: 0x3d5a80, css: '#3d5a80', open: 100, div: 0.035, blurb: L('Owns a bit of every stock sector at once.', '一次買進所有產業,最簡單的分散。') },
  green:   { name: L('Hummingbird EV', '蜂鳥電動車'),    code: L('GREEN', '綠能車'),    color: 0x2ec4b6, css: '#1fa799', open: 95,  div: 0,    blurb: L('Lives on subsidies and cheap loans.', '靠政策補助和低利率成長。') },
  def:     { name: L('Eagle Defense', '老鷹軍工'),      code: L('DEFENSE', '軍工'),    color: 0x6b7d3a, css: '#5a6b2c', open: 90,  div: 0.02, blurb: L('Rises when the world gets tense.', '國際情勢緊張時上漲。') },
  space:   { name: L('Astro Cat Space', '太空貓航太'),   code: L('SPACE', '太空股'),    color: 0x2b2d6e, css: '#2b2d6e', open: 70,  div: 0,    vol: 0.05, blurb: L('Low-orbit satellites and reusable rockets. Big dreams, no profit yet, wild swings.', '低軌衛星、可回收火箭。夢想很大、還沒賺錢,波動也大。') },
  game:    { name: L('Fox Games', '狐狸遊戲'),   code: L('GAMES', '遊戲'),      color: 0xb5179e, css: '#a01389', open: 80,  div: 0.01, blurb: L('One hit title can change everything.', '一款大作就能改變一切。') },
  crypto:  { name: L('ParrotCoin', '鸚鵡幣'),            code: L('CRYPTO', '加密貨幣'), color: 0xf7931a, css: '#dd7d0a', open: 100, div: 0,    vol: 0.14, blurb: L('Not a stock. No earnings behind it, wild swings.', '不是股票,背後沒有獲利,波動極大。') },
};
const KEYS = Object.keys(SECTORS);
// 外圈 19x19 = 72 格。四個角:起點 / 商店 / 銀行 / 商店
const N = 19;
const TILES = (() => {
  const t = new Array(4 * (N - 1)).fill(null);
  t[0] = 'start'; t[18] = 'shop'; t[36] = 'bank'; t[54] = 'shop';     // 四個角(銀行在最遠的角)
  [4, 11, 14, 22, 32, 39, 48, 57, 61, 68].forEach((i) => { t[i] = 'chance'; });      // 市場事件(32、68 是兩條小路的出口,一出來就抽事件)
  [9, 28, 51, 70].forEach((i) => { t[i] = 'fate'; });  // 命運:每一邊一格(內部認購、警察局都是命運牌)
  [6, 25, 44, 64].forEach((i) => { t[i] = 'gift'; });   // 禮物(股利每回合自動配,不需要股息結算格)
  // 剩下 50 格:25 種資產各兩格
  const seq = [...KEYS, ...KEYS];
  let j = 0; for (let i = 0; i < t.length; i++) if (!t[i]) t[i] = seq[j++];
  return t;
})();
const TILE_COLOR = { start: 0xff8fc0, chance: 0xffd24a, fate: 0xc08cf5, fee: 0x9aa0ad, shop: 0x5aa9ff, gift: 0xf27a98, ipo: 0x2fbf9f, bank: 0x4a63b0 };
// 事件卡:只寫「有變動的資產」,沒寫的就是不動。
// 大盤 ETF 不用自己寫 —— 它等於所有「股票類股」這次漲跌的平均(黃金、債券、加密貨幣不算)
const NON_EQUITY = new Set(['gold', 'bond', 'crypto', 'etf', 'agri']);
// 大盤趨勢:有些事件會改變之後「每回合大盤的漲跌」(trend),一直維持到下一張會改趨勢的事件。
//   重大危機 −2%、壞消息 −1%、好消息 +1%、降息 +2%;只影響個別公司或產業的事件不改
const EVT = (trend, t, w, m) => Object.assign(EV(t, w, m), { trend });
const EV = (t, w, m) => {
  const full = Object.fromEntries(KEYS.map((k) => [k, m[k] ?? 1]));
  const eq = KEYS.filter((k) => !NON_EQUITY.has(k));
  full.etf = m.etf ?? Math.round(eq.reduce((a, k) => a + full[k], 0) / eq.length * 100) / 100;
  return { t, w, m: full };
};
const EVENTS = [
  EVT(0.02, L('Rate cut announced', '央行宣布降息'), L('Cheaper borrowing lifts growth stocks, property and bonds; banks earn less on loans.', '借錢變便宜,成長股、不動產、債券受惠;銀行利差縮小。'),
    {robot: 1.12, ecom: 1.12, space: 1.25, agri: 1.02, soft: 1.16,  tech: 1.20, chip: 1.10, yield: 0.97, reit: 1.12, fin: 0.94, trans: 1.04, bio: 1.12, bond: 1.08, util: 1.05, gold: 1.04, green: 1.12, disc: 1.06, game: 1.08, mat: 1.03, crypto: 1.15 }),
  EVT(0.01, L('AI server demand booms', 'AI 伺服器需求爆發'), L('Scarce chips let makers raise prices. Data centers need more power too.', '晶片供不應求,廠商有漲價空間;資料中心也更吃電。'),
    {robot: 1.12, space: 1.06, soft: 1.08,  tech: 1.10, chip: 1.25, oil: 0.95, trans: 1.03, game: 1.05, util: 1.04 }),
  EV(L('Oil supply shock', '原油供給吃緊'), L('Energy gains; fuel-hungry shippers and travel suffer.', '能源股受惠;最吃燃料的運輸和旅遊受傷最重。'),
    {ecom: 0.95, soft: 0.96,  tech: 0.93, chip: 0.95, oil: 1.25, reit: 0.97, fin: 0.98, trans: 0.82, mat: 1.06, disc: 0.92, staples: 0.97, green: 1.10, gold: 1.04, util: 0.96, def: 1.03 }),
  EVT(-0.02, L('Black swan', '黑天鵝事件'), L('Panic selling hits the riskiest assets hardest. Gold and bonds are where money hides.', '恐慌賣壓下風險高的跌最多,資金躲進黃金和債券。'),
    {robot: 0.85, ecom: 0.85, space: 0.8, agri: 0.95, soft: 0.82,  tech: 0.80, chip: 0.80, yield: 0.95, oil: 0.90, health: 0.98, reit: 0.90, fin: 0.85, trans: 0.85, bio: 0.78, gold: 1.15, bond: 1.06, staples: 0.97, util: 0.97, disc: 0.82, mat: 0.86, green: 0.80, game: 0.88, def: 1.02, crypto: 0.65 }),
  EVT(0.01, L('Strong earnings season', '財報季優於預期'), L('Profits beat forecasts across the board.', '企業獲利普遍優於預期。'),
    {robot: 1.1, ecom: 1.1, space: 1.08, agri: 1.02, soft: 1.10,  tech: 1.12, chip: 1.12, yield: 1.04, oil: 1.04, health: 1.06, reit: 1.03, fin: 1.08, trans: 1.08, bio: 1.05, staples: 1.03, disc: 1.10, util: 1.02, mat: 1.07, green: 1.08, game: 1.10, def: 1.04, gold: 0.98, bond: 0.99, crypto: 1.05 }),
  EVT(-0.01, L('Rate hike surprise', '意外升息'), L('Higher rates hurt growth, property and bonds, but banks earn more on loans.', '升息壓抑成長股、不動產和債券,銀行利差反而擴大。'),
    {robot: 0.9, ecom: 0.92, space: 0.85, agri: 0.97, soft: 0.86,  tech: 0.90, chip: 0.92, yield: 1.03, oil: 1.02, reit: 0.88, fin: 1.12, trans: 0.96, bio: 0.88, bond: 0.92, util: 0.94, gold: 0.96, green: 0.88, disc: 0.94, game: 0.92, staples: 0.99, mat: 0.97, crypto: 0.82 }),
  EV(L('Flu season hits', '流感疫情升溫'), L('Demand for medicine jumps; people stay home, travel less and play more games.', '藥品需求大增;大家待在家,少出遊、多打電動。'),
    {ecom: 1.06, soft: 1.06,  tech: 0.98, oil: 0.96, health: 1.20, trans: 0.94, bio: 1.22, disc: 0.85, staples: 1.06, game: 1.12 }),
  EV(L('New drug approved', '新藥獲准上市'), L('One approval can change everything for a biotech.', '一張藥證就能改變一家生技公司的命運。'),
    { health: 1.08, bio: 1.35 }),
  EV(L('Shipping rates surge', '運價大漲'), L('Ports are jammed and ships are scarce, so freight prices jump.', '港口塞港、運力不足,運費跟著漲。'),
    {ecom: 0.94,  tech: 0.98, oil: 1.05, trans: 1.28, mat: 1.04, staples: 0.98, disc: 0.98 }),
  EV(L('Clinical trial fails', '臨床試驗失敗'), L('Biotech has no profits to fall back on, so bad news hits hard.', '生技公司沒有獲利撐腰,壞消息一來跌很深。'),
    { health: 0.97, bio: 0.70 }),
  EV(L('Geopolitical tension rises', '國際情勢緊張'), L('Money moves to defense, energy and gold; trade and travel suffer.', '資金流向軍工、能源和黃金;貿易與旅遊受影響。'),
    {space: 1.1, agri: 1.06, soft: 0.96,  def: 1.28, gold: 1.10, oil: 1.12, trans: 0.92, disc: 0.90, tech: 0.95, chip: 0.93, bond: 1.03, crypto: 0.92 }),
  EV(L('Green subsidy passed', '綠能補助通過'), L('Policy support matters most for industries that are not yet profitable.', '還沒賺錢的產業,最吃政策支持。'),
    { green: 1.30, util: 1.05, mat: 1.05, oil: 0.94 }),
  EV(L('Hit game launches', '遊戲大作上市'), L('A single hit can carry a game company for years.', '一款大作可以養一家遊戲公司好幾年。'),
    {soft: 1.03,  game: 1.30, tech: 1.04, chip: 1.03 }),
  EVT(-0.01, L('Inflation runs hot', '通膨升溫'), L('Hard assets hold value; bonds and growth stocks lose it.', '實體資產保值;債券和成長股受壓。'),
    {ecom: 0.94, agri: 1.12, soft: 0.92,  gold: 1.10, mat: 1.12, oil: 1.08, staples: 1.04, reit: 1.03, bond: 0.94, tech: 0.93, disc: 0.92, crypto: 1.05 }),
  EVT(0.01, L('Holiday shopping boom', '年終消費旺季'), L('When people feel rich, they shop online and in stores, eat out and travel. Delivery firms are busy too.', '大家手頭寬裕時會網購、逛街、聚餐、出遊,電商和物流最忙。'),
    { ecom: 1.25, disc: 1.10, staples: 1.06, trans: 1.08, fin: 1.03, game: 1.06 }),
  EV(L('Crypto exchange hacked', '加密貨幣交易所遭駭'), L('With no earnings behind it, confidence is all crypto has.', '加密貨幣背後沒有獲利,信心一垮就崩。'),
    { crypto: 0.55, fin: 0.98, gold: 1.03 }),
  EV(L('Crypto mania', '幣圈狂熱'), L('Prices can soar on hype alone, and fall the same way.', '純靠熱度也能暴漲,當然也能同樣暴跌。'),
    {space: 1.05, soft: 1.03,  crypto: 1.60, chip: 1.05, tech: 1.02 }),
  EV(L('Commodity boom', '原物料行情'), L('Building booms push up steel, cement and energy.', '基礎建設需求推升鋼鐵、水泥和能源。'),
    { mat: 1.25, oil: 1.08, trans: 1.04 }),
  // ── 戰爭、總經數據、疫情、金融風暴 ──
  EVT(-0.01, L('War breaks out in the Middle East', '中東爆發戰爭'), L('Oil routes are at risk, so crude jumps. Money runs to defense and gold; shipping and travel get hit.', '產油區和航道有風險,油價飆漲。資金湧向軍工和黃金,運輸與旅遊受創。'),
    {ecom: 0.95, agri: 1.10, soft: 0.94,  oil: 1.30, def: 1.22, gold: 1.12, green: 1.06, mat: 1.05, bond: 1.03, trans: 0.85, disc: 0.88, tech: 0.94, chip: 0.94, fin: 0.96, crypto: 0.92 }),
  EVT(-0.02, L('A major war breaks out', '大規模戰爭爆發'), L('Almost everything falls. Only defense, gold and energy rise as investors flee risk.', '幾乎所有資產都下跌,只有軍工、黃金、能源上漲,資金全面避險。'),
    {ecom: 0.88, space: 1.1, agri: 1.15, soft: 0.88,  def: 1.35, gold: 1.18, oil: 1.15, bond: 1.05, mat: 1.04, staples: 1.03, chip: 0.85, tech: 0.88, disc: 0.80, trans: 0.85, fin: 0.90, reit: 0.92, crypto: 0.85, green: 0.92, game: 0.94, bio: 0.95 }),
  EVT(0.01, L('CPI comes in lower than expected', 'CPI 低於預期'), L('Cooling inflation means rate cuts may come sooner. Growth stocks, property and bonds cheer.', '通膨降溫代表可能提早降息,成長股、不動產、債券上漲。'),
    {robot: 1.08, ecom: 1.08, space: 1.12, soft: 1.09,  tech: 1.10, crypto: 1.10, chip: 1.08, reit: 1.08, green: 1.08, bio: 1.07, bond: 1.06, game: 1.06, disc: 1.05, fin: 0.97, gold: 0.97, oil: 0.98 }),
  EVT(0.01, L('Strong jobs report', '非農就業強勁'), L('More people working means more spending, but rates may stay high for longer.', '就業好代表消費有力,但利率可能維持高檔更久。'),
    {robot: 1.06, ecom: 1.08, soft: 0.97,  disc: 1.08, fin: 1.06, trans: 1.05, mat: 1.04, staples: 1.02, bond: 0.95, gold: 0.97, reit: 0.97, tech: 0.98 }),
  EVT(-0.01, L('Weak jobs report', '非農就業疲弱'), L('Fewer jobs means less spending. Money moves to bonds, gold and steady payers.', '就業轉弱代表消費降溫,資金轉向債券、黃金和穩定配息的資產。'),
    {robot: 0.95, ecom: 0.94, agri: 1.02, soft: 1.02,  bond: 1.06, gold: 1.05, util: 1.03, staples: 1.02, tech: 1.02, disc: 0.92, fin: 0.94, trans: 0.95, mat: 0.96 }),
  EVT(-0.02, L('Global pandemic', '全球疫情爆發'), L('People stay home: medicine, games and groceries rise; travel, transport and oil collapse.', '大家待在家:醫藥、遊戲、民生上漲;旅遊、運輸、油價重挫。'),
    {ecom: 1.15, space: 0.92, agri: 1.06, soft: 1.12,  bio: 1.30, health: 1.18, game: 1.15, staples: 1.08, tech: 1.06, gold: 1.06, bond: 1.04, disc: 0.70, trans: 0.78, oil: 0.80, reit: 0.88, fin: 0.90, mat: 0.92 }),
  EVT(-0.02, L('Financial crisis', '金融風暴'), L('Banks fail and credit freezes. Nearly everything falls together; only gold and bonds hold.', '銀行倒閉、信用緊縮,幾乎所有資產一起跌,只有黃金和債券撐住。'),
    {robot: 0.8, ecom: 0.82, space: 0.75, agri: 0.92, soft: 0.80,  gold: 1.20, bond: 1.10, fin: 0.65, crypto: 0.60, reit: 0.75, disc: 0.75, tech: 0.78, chip: 0.78, green: 0.78, mat: 0.80, trans: 0.82, oil: 0.82, bio: 0.82, game: 0.85, yield: 0.90, def: 0.95, staples: 0.95, util: 0.94, health: 0.94 }),
  // 兩個歷史上真的發生過的泡沫破裂:網路泡沫(2000)、次級房貸風暴(2008)
  EVT(-0.01, L('Dot-com bubble bursts', '網路泡沫破裂'), L('Internet companies with no profits were priced as if they would rule the world. When the money ran out, tech crashed hardest; old-economy and safe assets held up.', '還沒賺錢的網路公司被當成未來霸主炒作。資金一抽走,科技股跌最慘;傳統產業和避險資產撐得住。'),
    {robot: 0.85, ecom: 0.8, space: 0.75, soft: 0.70,  tech: 0.65, chip: 0.75, game: 0.80, crypto: 0.70, green: 0.85, fin: 0.94, disc: 0.95, bond: 1.06, gold: 1.05, staples: 1.03, util: 1.04, health: 1.02, yield: 1.02 }),
  EVT(-0.02, L('Subprime mortgage crisis', '次級房貸風暴'), L('Banks lent to people who could not pay, packaged the loans and sold them on. When house prices fell, property and banks collapsed together and dragged everything that depends on borrowing.', '銀行把錢借給還不起的人,再把房貸包裝成商品賣出去。房價一跌,不動產和銀行一起崩,靠借錢運作的產業全被拖下水。'),
    {robot: 0.88, ecom: 0.88, space: 0.85, soft: 0.90,  reit: 0.65, fin: 0.65, disc: 0.85, mat: 0.88, trans: 0.90, tech: 0.90, chip: 0.90, green: 0.90, crypto: 0.85, yield: 0.92, gold: 1.12, bond: 1.08, staples: 1.02, util: 1.01 }),
  // ── 更多金融史上的事件 ──
  // 黑色星期一:恐慌一天崩盤,但下一回合會自動反彈一半(rebound)—— 教「恐慌殺低不一定是對的」
  Object.assign(EVT(-0.01, L('Black Monday', '黑色星期一'), L('In 1987 program trading sold into a falling market and stocks dropped 22% in one day. Panic feeds on itself, and part of the drop came back soon after.', '1987 年程式交易在下跌中自動賣出,股市一天崩 22%。恐慌會自我放大,但之後有一部分很快就漲回來了。'),
    {robot: 0.84, ecom: 0.86, space: 0.82, agri: 0.95,  tech: 0.82, soft: 0.82, chip: 0.82, yield: 0.88, oil: 0.85, health: 0.88, reit: 0.85, fin: 0.80, trans: 0.84, bio: 0.82, staples: 0.90, disc: 0.82, util: 0.90, mat: 0.85, green: 0.82, def: 0.88, game: 0.82, crypto: 0.80, gold: 1.05, bond: 1.03 }), { rebound: 0.5 }),
  EVT(-0.01, L('Asian financial crisis', '亞洲金融風暴'), L('In 1997 hot money fled Thailand and Korea, currencies collapsed and anything tied to Asian trade fell with them.', '1997 年熱錢撤出泰國、韓國,貨幣崩盤,跟亞洲貿易有關的全被拖下水。'),
    {agri: 0.95,  trans: 0.85, mat: 0.88, fin: 0.88, disc: 0.90, chip: 0.93, tech: 0.95, gold: 1.06, bond: 1.05 }),
  EVT(-0.01, L('European debt crisis', '歐債危機'), L('From 2010 Greece could not pay its debts. Even government bonds can default, and the banks holding them bleed.', '2010 年起希臘還不出國債。連國債都可能違約,抱著國債的銀行跟著失血。'),
    { bond: 0.88, fin: 0.85, reit: 0.92, disc: 0.95, gold: 1.08, def: 1.02 }),
  EVT(-0.01, L('Bank run', '銀行擠兌'), L('Once depositors fear a bank is in trouble, they all rush to withdraw, and even a sound bank can run dry in days. Confidence is all a bank has.', '存款人一擔心銀行出問題就搶著領錢,就算是健全的銀行,也可能幾天內被提光存款。銀行靠的就是信心。'),
    { fin: 0.80, soft: 0.90, tech: 0.92, bio: 0.94, bond: 1.06, gold: 1.03 }),
  EVT(-0.01, L('Trade war and tariffs', '中美貿易戰'), L('From 2018 tariffs hit chips, metals and shipping; the extra cost gets passed to consumers.', '2018 年起關稅打到晶片、原物料和航運,多出來的成本轉嫁給消費者。'),
    {robot: 0.92, ecom: 0.9, space: 0.92, agri: 0.90,  chip: 0.88, mat: 0.90, trans: 0.92, staples: 0.96, tech: 0.95, def: 1.05, gold: 1.02 }),
  EV(L('Chip shortage', '晶片荒'), L('In 2021 there were not enough chips: chip makers raised prices while car and console makers waited.', '2021 年晶片不夠用:晶片廠漲價,汽車和遊戲機廠只能等。'),
    {robot: 0.9, space: 0.9,  chip: 1.20, tech: 0.95, green: 0.88, game: 0.94 }),
  // 股利事件:只有「原本就有配息」的公司會抽到(不含 ETF、債券),抽到時才決定是哪幾家。殖利率每次 ±1 個百分點,最高 8%、最低 0.5%
  //   divUp:營收變好、配更多(不會挑到目前配最多的那家,讓後面的追得上);divCut:營收變差、配更少('top' = 配最多的那家,'any' = 隨機一家)
  Object.assign(EV(L('Record revenue, bigger dividend', '營收創新高,加發股利'), L('Sales hit a record, so the company pays shareholders more. The yield goes up 1 point and the price rises too.', '營收創下新高,公司決定多配一點股利給股東。殖利率提高 1 個百分點,股價也跟著漲。'), {}), { divUp: 1 }),
  Object.assign(EV(L('Orders pour in, dividend raised', '訂單滿載,調高股利'), L('A busy season fills the order book. With more cash coming in, the company raises its dividend by 1 point.', '旺季訂單接不完,現金一直進來,公司把股利調高 1 個百分點。'), {}), { divUp: 1 }),
  Object.assign(EVT(0.01, L('Boom year, payouts rise', '景氣大好,多家公司加發股利'), L('Business is good almost everywhere: several dividend payers raise their payout by 1 point at once.', '景氣大好,好幾家原本就有配息的公司同時把股利調高 1 個百分點。'), {}), { divUp: 3 }),
  Object.assign(EV(L('Revenue falls, dividend cut', '營收衰退,削減股利'), L('Sales dropped and the biggest payer can no longer afford it. Its yield falls 1 point and income investors sell.', '營收下滑,配息最高的公司撐不住了。殖利率少 1 個百分點,想領股息的人賣出,股價下跌。'), {}), { divCut: 'top' }),
  Object.assign(EV(L('Profits miss, smaller dividend', '獲利不如預期,股利縮水'), L('Profits came in below forecast, so the company pays out less. The yield falls 1 point and the price drops.', '獲利不如預期,公司少配一點股利。殖利率少 1 個百分點,股價也跌。'), {}), { divCut: 'any' }),
  // 迷因股軋空:挑「場上被放空最多」的那檔暴漲 50%,所有空單強迫回補(meme:抽到時才決定是哪一檔)
  Object.assign(EV(L('Meme stock squeeze', '迷因股軋空'), L('In 2021 retail traders piled into the most-shorted stock and squeezed the short sellers out. Every short on it is forced to buy back.', '2021 年散戶一起買被放空最多的股票,把放空的人全部軋出場。這檔的空單全部強迫回補。'), {}), { meme: true }),
  EV(L('Antitrust fine', '反壟斷巨額罰款'), L('Regulators fine a platform giant for abusing its position. Big tech carries regulatory risk.', '監管機關對平台巨頭開出巨額罰款。大型科技公司有監管風險。'),
    {ecom: 0.92,  tech: 0.88, soft: 0.90, game: 0.97 }),
  EV(L('Massive data breach', '大型資安事件'), L('Personal data of millions leaks. Trust is expensive to rebuild, and security costs go up for everyone.', '數百萬人的個資外洩。信任很難重建,所有公司的資安成本都上升。'),
    {ecom: 0.95,  soft: 0.90, fin: 0.94, tech: 0.96 }),
  EVT(0.01, L('Infrastructure bill passes', '基礎建設法案通過'), L('Government spending on roads, grids and ports flows to materials, transport and utilities; more borrowing weighs on bonds.', '政府砸錢修路、電網、港口,原物料、運輸和公用事業受惠;多借錢讓債券承壓。'),
    {robot: 1.08, agri: 1.02,  mat: 1.15, trans: 1.08, util: 1.05, green: 1.06, bond: 0.97 }),
  EV(L('Nuclear accident', '核災事故'), L('In 2011 the Fukushima disaster turned countries away from nuclear power and toward renewables and fossil fuels.', '2011 年福島核災讓各國遠離核電,轉向再生能源和化石燃料。'),
    { util: 0.85, green: 1.12, oil: 1.06, gold: 1.04, reit: 0.97 }),
  EVT(-0.01, L('Property bubble bursts', '房市泡沫破裂'), L('When prices are pushed up by borrowed money, the boom lasts only as long as the lending. Once loans stop flowing into property, prices fall and banks and builders fall with them.', '房價靠借來的錢推高,借錢一停就撐不住。資金不再流進房地產,房價一跌,銀行和建商跟著倒。'),
    { reit: 0.75, fin: 0.90, mat: 0.92, staples: 0.97, disc: 0.96, gold: 1.04, bond: 1.03 }),
  EV(L('Drought and crop failure', '乾旱歉收'), L('A bad harvest sends grain prices up. Farms that still have crops earn more; food makers and restaurants pay more for ingredients.', '歉收讓穀物價格大漲。還有收成的農場賺更多;食品廠和餐廳的原料變貴。'),
    { agri: 1.25, staples: 0.94, disc: 0.96, trans: 1.02 }),
  // 政府普發現金:除了股價變動,每位玩家還直接拿到現金(cash)
  Object.assign(EVT(0.01, L('Government cash handout', '政府普發現金'), L('Everyone gets cash from the government. People spend it, so shops, restaurants and travel do well; the government borrows more, so bonds dip.', '政府發現金給每個人。大家拿到錢會去消費,零售、餐飲、旅遊受惠;政府要多借錢,債券小跌。'),
    {ecom: 1.15, agri: 1.03, soft: 1.02,  disc: 1.12, staples: 1.06, game: 1.06, trans: 1.04, fin: 1.03, reit: 1.02, gold: 1.02, bond: 0.96 }), { cash: 1000 }),
  // 總體好消息(讓大盤轉多),和上面的總體壞消息一張對一張:停火↔戰爭、疫苗↔疫情、通膨降溫↔通膨升溫、貿易協議↔貿易戰、央行救市↔金融風暴
  EVT(0.01, L('Ceasefire agreement signed', '停火協議簽署'), L('The fighting stops. Ships and planes run normal routes again and travel recovers; oil and defense lose their war premium.', '戰爭停火。船跟飛機恢復正常航線,旅遊回溫;石油和軍工的戰爭溢價消退。'),
    {def: 0.80, oil: 0.88, gold: 0.93, bond: 0.98, trans: 1.15, disc: 1.15, fin: 1.06, mat: 1.05, chip: 1.05, tech: 1.05, reit: 1.04, green: 1.05, crypto: 1.05 }),
  EVT(0.01, L('Vaccine approved worldwide', '疫苗全面施打'), L('People can go out again: travel, shipping and banks bounce back hard. Stay-at-home stocks like games and software cool off.', '大家可以出門了:旅遊、航運、銀行強力反彈;遊戲、軟體這類宅經濟退燒。'),
    {ecom: 0.95, bio: 1.12, disc: 1.30, trans: 1.20, fin: 1.08, reit: 1.08, oil: 1.12, mat: 1.06, game: 0.88, soft: 0.92, health: 0.95, gold: 0.95, bond: 0.97 }),
  EVT(0.01, L('Inflation cools down', '通膨降溫'), L('Prices stop rising so fast, so rates can come down later. Growth stocks, property and bonds rise; commodities and gold lose their inflation shield.', '物價漲勢趨緩,之後有機會降息。成長股、不動產、債券上漲;原物料和黃金失去抗通膨題材。'),
    {robot: 1.05, ecom: 1.08, space: 1.1, tech: 1.10, soft: 1.10, chip: 1.06, reit: 1.10, bond: 1.06, util: 1.04, disc: 1.06, game: 1.04, green: 1.06, crypto: 1.06, gold: 0.92, agri: 0.92, mat: 0.92, oil: 0.93 }),
  EVT(0.01, L('Trade deal reached', '貿易協議達成'), L('Tariffs come off. Factories can sell abroad again: chips, materials and shipping lead the rally.', '關稅取消,工廠又能外銷:半導體、原物料、航運領漲。'),
    {robot: 1.06, ecom: 1.06, chip: 1.14, mat: 1.10, trans: 1.12, agri: 1.06, tech: 1.06, staples: 1.03, disc: 1.04, def: 0.95, gold: 0.97 }),
  EVT(0.02, L('Central bank to the rescue', '央行出手救市'), L('The central bank buys bonds and pumps money into markets (QE). Almost everything rises, banks and property most; extra money also lifts gold and crypto.', '央行大買債券、把錢灌進市場(量化寬鬆)。幾乎全面上漲,金融、不動產最多;多出來的錢也推升黃金和加密貨幣。'),
    {robot: 1.08, ecom: 1.08, space: 1.15, fin: 1.15, reit: 1.14, bond: 1.06, tech: 1.08, soft: 1.08, chip: 1.08, disc: 1.08, mat: 1.06, green: 1.08, gold: 1.06, crypto: 1.18, game: 1.04, trans: 1.05 }),
  EVT(0.01, L('Tax cut bill passes', '減稅法案通過'), L('Companies and families keep more of what they earn. Profits rise across the board, banks and shops most; the government borrows more, so bonds dip.', '企業和家庭少繳稅、多留錢。各行業獲利提升,金融和零售最明顯;政府要多借錢,債券小跌。'),
    {robot: 1.06, ecom: 1.1, fin: 1.08, disc: 1.10, staples: 1.04, tech: 1.05, chip: 1.04, mat: 1.05, trans: 1.04, reit: 1.04, game: 1.04, bond: 0.95 }),
  EVT(0.01, L('Soft landing', '經濟軟著陸'), L('Rate hikes beat inflation without causing a recession. Worry fades and most stocks drift up together.', '升息壓住了通膨,經濟卻沒有衰退。擔心散去,大部分股票一起小漲。'),
    {robot: 1.06, ecom: 1.06, space: 1.06, tech: 1.05, soft: 1.05, chip: 1.05, fin: 1.06, disc: 1.06, reit: 1.05, trans: 1.04, mat: 1.04, green: 1.04, game: 1.03, staples: 1.02, bond: 1.02, gold: 0.96 }),
  // 太空產業新聞(不改大盤趨勢)
  EV(L('Satellite internet wins a huge contract', '低軌衛星拿下大訂單'), L('Governments and airlines sign up for low-orbit satellite internet. Space stocks jump; old telecoms get a new rival.', '政府和航空公司簽下低軌衛星上網的大訂單,太空股大漲;傳統電信多了競爭對手。'),
    {space: 1.35, chip: 1.04, def: 1.04, tech: 1.03, yield: 0.96 }),
  EV(L('Rocket explodes on launch', '火箭發射失敗'), L('A rocket blows up after liftoff. Launches are delayed and insurance gets pricier. Companies with no profit yet suffer most from delays.', '火箭升空後爆炸,發射計畫延後、保險費變貴。還沒賺錢的公司最怕計畫延誤。'),
    {space: 0.72, def: 0.97 }),
  // 電商、機器人產業新聞(不改大盤趨勢)
  EV(L('Singles Day sales smash records', '雙十一購物節業績爆發'), L('Shoppers splurge in one day of online deals. E-commerce soars and delivery firms run full.', '網購節一天的業績破紀錄,電商大漲,物流公司也滿載。'),
    {ecom: 1.30, trans: 1.06, soft: 1.03, staples: 1.02 }),
  EV(L('Delivery workers strike', '物流大罷工'), L('Packages pile up for weeks. Online shops cannot deliver, and customers go back to stores.', '包裹堆了好幾週送不出去,電商出不了貨,客人又回到實體店。'),
    {ecom: 0.82, trans: 0.92, staples: 1.03 }),
  EV(L('Humanoid robots enter mass production', '人形機器人量產'), L('Robots that can work on ordinary factory lines go on sale. Chip and software makers that power them gain too.', '能直接上產線工作的人形機器人開始量產,供應晶片和軟體的公司也一起受惠。'),
    {robot: 1.32, chip: 1.05, soft: 1.03, mat: 1.02 }),
  EV(L('Robot safety accident', '機器人工安意外'), L('A factory robot injures workers. Regulators order inspections and buyers pause orders.', '工廠機器人造成工安意外,政府要求全面檢查,客戶暫停下單。'),
    {robot: 0.78, chip: 0.98 }),
  // ── 科技與產業政策 ──
  EV(L('Big tech regulation bill passes', '大型科技監管法案通過'), L('New rules limit how platforms use data and treat sellers. Platforms, software and online shops take the hit; old-economy firms barely notice.', '新法規限制平台怎麼用個資、怎麼對待賣家。平台、軟體、電商承壓;傳統產業幾乎不受影響。'),
    { ecom: 0.88, soft: 0.88, tech: 0.90, game: 0.95, staples: 1.02, util: 1.02 }),
  EVT(-0.01, L('The AI bubble cools', 'AI 泡沫降溫'), L('Spending on AI stops growing as fast as the hype promised. The richest-valued growth stocks fall together: the mirror image of an AI server boom.', 'AI 投資的成長跟不上炒作的預期。估值最高的成長股一起回檔,和「AI 伺服器需求爆發」正好相反。'),
    { chip: 0.82, robot: 0.85, soft: 0.86, space: 0.85, tech: 0.88, game: 0.95, bond: 1.03, gold: 1.02, staples: 1.02, util: 1.02 }),
  EV(L('Data centers run short of power', '資料中心缺電'), L('AI data centers need more electricity than the grid can deliver. Chip and software growth slows; power producers of every kind gain.', 'AI 資料中心要的電比電網供得起的多。晶片和軟體的成長被卡住,各種發電業者受惠。'),
    { chip: 0.92, tech: 0.94, soft: 0.94, util: 1.12, green: 1.10, oil: 1.08 }),
  EV(L('Major cloud outage', '重大雲端服務中斷'), L('A cloud provider goes down for a day and thousands of apps, shops and banks stop working. Companies learn not to rely on a single provider.', '雲端業者當機一天,上千個 App、網店和銀行服務跟著停擺。企業學到不能把所有服務放在同一家。'),
    { soft: 0.88, ecom: 0.90, fin: 0.95, game: 0.95, tech: 0.97 }),
  EV(L('Global chip export ban', '全球晶片出口禁令'), L('Governments ban selling advanced chips abroad. Chip makers lose customers, and machines that need those chips get harder to build; defense gains a little.', '各國禁止出口先進晶片。晶片廠少了客戶,需要這些晶片的機器也更難生產;軍工小幅受惠。'),
    { chip: 0.80, tech: 0.90, robot: 0.90, space: 0.95, def: 1.05 }),
  EVT(0.01, L('Factories come home', '製造業回流'), L('Companies move production back home to make supply chains safer. Automation, materials and chips are needed for the new plants; long-haul shipping loses some routes.', '企業把工廠搬回國內,讓供應鏈更安全。新工廠需要自動化、原物料和晶片;長程航運少了一些航線。'),
    { robot: 1.15, mat: 1.10, chip: 1.08, def: 1.02, trans: 0.97 }),
  // ── 天災、能源、糧食 ──
  EV(L('Shipping lane blocked', '海運航道封鎖'), L('A key canal or strait closes. Ships take the long way, so freight, oil and raw materials get pricier; online shops and travel pay the bill.', '重要運河或海峽被封鎖,船只能繞遠路。運費、油價和原物料變貴,電商、零售和旅遊付出代價。'),
    { trans: 1.18, oil: 1.10, mat: 1.06, agri: 1.04, ecom: 0.92, disc: 0.92, staples: 0.97 }),
  EV(L('Major natural disaster', '大型天然災害'), L('Insurers and banks pay for the damage and property values drop. Rebuilding later lifts building materials and utilities.', '保險和銀行要負擔損失,不動產價值下跌。之後的重建讓建材和公用事業受惠。'),
    { fin: 0.90, reit: 0.88, disc: 0.96, mat: 1.10, util: 1.04 }),
  EV(L('Extreme heat strains the grid', '極端高溫,電力吃緊'), L('Air conditioners run all day and power prices jump. Power producers gain; factories and chip fabs pay more for electricity.', '冷氣整天開,電價飆漲。發電業者受惠;工廠和晶片廠的電費成本上升。'),
    { util: 1.10, green: 1.08, chip: 0.95, mat: 0.96, robot: 0.97, disc: 0.97 }),
  EV(L('Food export ban', '糧食出口禁令'), L('A big grain exporter stops selling abroad. Farm prices jump; food makers, restaurants and shippers pay more.', '糧食出口大國禁止出口。農產品大漲,食品廠、餐飲和運輸的成本上升。'),
    { agri: 1.25, staples: 0.93, disc: 0.94, trans: 0.97 }),
  // ── 利率、信用、匯率 ──
  EVT(0.01, L('Mortgage rates drop sharply', '房貸利率大降'), L('Cheaper home loans bring buyers back. Property and banks lend and sell more, and new homeowners buy furniture and appliances.', '房貸變便宜,買房的人回來了。不動產和銀行生意變好,新屋主也會買家具、家電。'),
    { reit: 1.15, fin: 1.06, disc: 1.05, ecom: 1.04, mat: 1.04, bond: 1.03 }),
  EV(L('Wave of layoffs', '企業裁員潮'), L('Big companies cut jobs to protect profits. People who fear for their jobs spend less; money moves to bonds and gold.', '大公司裁員保獲利。擔心丟工作的人少花錢,資金轉向債券和黃金。'),
    { soft: 0.90, tech: 0.92, ecom: 0.92, disc: 0.93, bond: 1.04, gold: 1.04 }),
  EV(L('A large company goes bankrupt', '大型企業倒閉'), L('A well-known company cannot pay its debts. Lenders lose money and investors start to doubt other borrowers too.', '一家知名企業還不出債務。借錢給它的人賠錢,投資人也開始懷疑其他借款人。'),
    { fin: 0.90, bond: 0.96, gold: 1.06 }),
  EV(L('Credit rating downgraded', '信用評等遭降級'), L('A rating agency says the government is a riskier borrower. Bond prices fall, banks holding them lose value, and gold gains.', '評等機構調降政府信用評等,代表借錢給它的風險變高。債券下跌、持有債券的銀行受傷,黃金受惠。'),
    { bond: 0.92, fin: 0.94, gold: 1.06 }),
  EVT(-0.01, L('A country defaults on its debt', '主權債務違約'), L('A government stops paying its bonds. Bond holders and banks take losses and money runs to gold. A government bond is only as safe as the government.', '一國政府停止償還國債。持有債券的人和銀行虧損,資金逃向黃金。國債只和發行的政府一樣安全。'),
    { bond: 0.85, fin: 0.85, reit: 0.94, disc: 0.95, gold: 1.12 }),
  EV(L('The dollar surges', '美元快速升值'), L('A strong dollar makes dollar-priced gold, oil and crops cost more for everyone else, so they fall; exporters earn less, but trips and imports abroad get cheaper.', '美元變強,用美元計價的黃金、石油、農產品對其他國家變貴,價格下跌;出口商少賺,但出國和進口變便宜。'),
    { gold: 0.93, mat: 0.92, oil: 0.94, agri: 0.94, crypto: 0.92, tech: 0.96, chip: 0.96, disc: 1.03, staples: 1.03 }),
  EV(L('The dollar slides', '美元快速貶值'), L('A weak dollar pushes up gold, raw materials and crypto priced in dollars. Imported goods cost more, so shops and food makers feel it.', '美元走弱,用美元計價的黃金、原物料、加密貨幣上漲;進口商品變貴,零售和食品業吃到成本。'),
    { gold: 1.10, mat: 1.08, agri: 1.06, oil: 1.06, crypto: 1.12, staples: 0.97, ecom: 0.96 }),
  EV(L('Bond yields spike', '債券殖利率暴升'), L('Bond prices fall and yields jump. Future profits are worth less today, so growth stocks and property drop; banks earn more on loans.', '債券價格大跌、殖利率暴升。未來的獲利換算成現在變得不值錢,成長股和不動產下跌;銀行放款賺得更多。'),
    { bond: 0.88, reit: 0.88, space: 0.88, soft: 0.90, tech: 0.92, green: 0.92, util: 0.95, fin: 1.05 }),
  EV(L('The yield curve inverts', '殖利率曲線倒掛'), L('Short-term rates rise above long-term ones, a classic recession warning. Cyclical stocks weaken; bonds and steady businesses hold up.', '短天期利率高過長天期,這是經典的衰退警訊。景氣循環股轉弱,債券和穩定的產業撐得住。'),
    { fin: 0.92, mat: 0.94, trans: 0.94, disc: 0.95, bond: 1.05, staples: 1.03, util: 1.03, gold: 1.03, health: 1.02 }),
  EVT(-0.02, L('Recession officially begins', '經濟正式進入衰退'), L('Two quarters of shrinking output. Spending, lending and shipping fall; gold, bonds and the things people buy anyway hold up.', '經濟連兩季萎縮。消費、放款、運輸一起下滑;黃金、債券和生活必需品相對抗跌。'),
    { disc: 0.85, trans: 0.85, mat: 0.85, ecom: 0.88, fin: 0.88, oil: 0.88, robot: 0.90, chip: 0.90, tech: 0.92, gold: 1.08, bond: 1.06, staples: 1.03, util: 1.02, health: 1.02 }),
  EVT(0.02, L('Recovery beats expectations', '經濟復甦超預期'), L('Growth comes back faster than anyone forecast. Almost everything tied to the business cycle rises; gold and bonds lose their appeal.', '經濟回溫的速度比所有人預測的都快。跟景氣有關的幾乎全部上漲,黃金和債券失去吸引力。'),
    { disc: 1.12, trans: 1.12, fin: 1.10, mat: 1.10, ecom: 1.10, robot: 1.08, chip: 1.08, tech: 1.08, oil: 1.06, gold: 0.94, bond: 0.94 }),
  // ── 單一公司事件(pick:抽到時才決定是哪一家;標題會加上公司名)──
  Object.assign(EV(L('Big merger announced', '大型併購案宣布'), L('A rival offers to buy this company at well above its share price. Shareholders of the target win right away.', '有大公司開出比股價高很多的價格要收購這家公司,被收購公司的股東立刻賺到。'), {}),
    { pick: { pool: ['tech', 'soft', 'chip', 'robot', 'bio', 'health', 'game', 'space'], f: 1.30 } }),
  Object.assign(EV(L('A hit product sells out', '明星產品大賣'), L('One product sells far beyond forecasts and lifts the whole company. One hit can change a company\'s year.', '一項產品賣得遠超預期,帶動整家公司。一個爆款就能改變一家公司這一年。'), {}),
    { pick: { pool: ['tech', 'game', 'staples', 'ecom', 'robot', 'green', 'health'], f: 1.25 } }),
  Object.assign(EV(L('Product recall', '產品召回'), L('A defect forces a recall. Repairs, refunds and lost trust hit this company hard; its suppliers dip too.', '產品出現瑕疵必須召回。維修、退款和失去的信任讓這家公司重挫,上游供應商也小跌。'), { chip: 0.98, mat: 0.98 }),
    { pick: { pool: ['tech', 'robot', 'green', 'staples', 'health', 'game'], f: 0.82 } }),
  Object.assign(EV(L('Accounting fraud exposed', '會計造假被揭露'), L('The company faked its profits. Its shares crash and investors trust every other company\'s numbers a bit less. This is corporate governance risk.', '公司被發現假造獲利,股價崩跌,投資人對其他公司的財報也少了一點信任。這就是公司治理風險。'), { fin: 0.97 }),
    { pick: { f: 0.70 } }),
  Object.assign(EV(L('CEO resigns suddenly', 'CEO 突然辭職'), L('The boss leaves with no successor in place. Growth companies built around one leader are hit hardest.', '老闆突然離職,也沒有接班人。靠一個領導人撐起來的成長型公司最受傷。'), {}),
    { pick: { pool: ['tech', 'soft', 'chip', 'robot', 'space', 'bio', 'green', 'game', 'ecom'], f: 0.88 } }),
  Object.assign(EV(L('Share buyback announced', '公司宣布庫藏股'), L('The company spends its cash buying back its own shares. Fewer shares means each remaining share owns more of the profits.', '公司拿現金買回自己的股票。流通股數變少,剩下的每一股分到的獲利就變多。'), {}),
    { pick: { pool: ['tech', 'soft', 'chip', 'fin', 'staples', 'oil', 'health', 'yield', 'def', 'ecom'], f: 1.10 } }),
  Object.assign(EV(L('Big share issue', '公司大幅增資'), L('The company sells lots of new shares to raise money. Each existing share now owns a smaller slice: that is dilution.', '公司大量發行新股來籌錢。原本每一股分到的比例變小了,這就是股權稀釋。'), {}),
    { pick: { f: 0.90 } }),
  // ── 資金流向、指數 ──
  EV(L('Big money flows into ETFs', 'ETF 大幅資金流入'), L('Investors pour money into index funds. The funds must buy every stock they hold, so the whole market rises together.', '大量資金湧進指數基金。基金必須照比例買進每一檔成分股,整個大盤一起上漲。'),
    { tech: 1.03, soft: 1.03, chip: 1.03, robot: 1.03, yield: 1.03, oil: 1.03, health: 1.03, reit: 1.03, fin: 1.03, trans: 1.03, bio: 1.03, staples: 1.03, disc: 1.03, ecom: 1.03, util: 1.03, mat: 1.03, green: 1.03, def: 1.03, space: 1.03, game: 1.03 }),
  EV(L('Money pours out of ETFs', 'ETF 大幅資金流出'), L('Investors pull money from index funds. The funds must sell every stock they hold, good or bad; money parks in bonds and gold.', '資金大舉撤出指數基金。基金不管好壞都要照比例賣出成分股,資金暫時停在債券和黃金。'),
    { tech: 0.97, soft: 0.97, chip: 0.97, robot: 0.97, yield: 0.97, oil: 0.97, health: 0.97, reit: 0.97, fin: 0.97, trans: 0.97, bio: 0.97, staples: 0.97, disc: 0.97, ecom: 0.97, util: 0.97, mat: 0.97, green: 0.97, def: 0.97, space: 0.97, game: 0.97, bond: 1.02, gold: 1.02 }),
  Object.assign(EV(L('Added to a major index', '被納入大型指數'), L('Index funds that track it now have to buy this stock, whatever they think of the company.', '追蹤這個指數的被動基金都得買進這檔,不管基金經理怎麼看這家公司。'), {}), { pick: { f: 1.10 } }),
  Object.assign(EV(L('Dropped from a major index', '被剔除大型指數'), L('Index funds that track it must sell this stock. The company did not change; the buyers did.', '追蹤這個指數的被動基金都得賣出這檔。公司本身沒變,變的是買家。'), {}), { pick: { f: 0.90 } }),
  // ── 公司財務 ──
  Object.assign(EV(L('Convertible bonds issued', '公司發行可轉換公司債'), L('The company borrows by selling bonds that can later turn into shares. It gets money cheaply, but shareholders may be diluted later.', '公司發行之後可以換成股票的債券來借錢。籌錢成本低,但將來轉換成股票時,原本股東可能被稀釋。'), {}),
    { pick: { pool: ['tech', 'soft', 'chip', 'robot', 'space', 'bio', 'green', 'game', 'ecom'], f: 0.95 } }),
  EV(L('Debt refinancing succeeds', '債務再融資成功'), L('Heavily indebted companies swap expensive old loans for cheaper new ones. Default risk falls, and property and lenders breathe easier.', '負債高的公司把利息貴的舊債換成便宜的新債,違約風險下降,不動產和放款的銀行都鬆一口氣。'),
    { reit: 1.10, fin: 1.04, util: 1.03, yield: 1.03 }),
  Object.assign(EV(L('Corporate bond default', '公司債爆雷'), L('The company misses a bond payment. Its shares crash, bond holders take losses and lenders start to worry about other borrowers.', '這家公司付不出公司債利息,股價重挫、債權人虧損,放款的銀行也開始擔心其他借款人。'), { fin: 0.94, bond: 0.96, gold: 1.03 }),
    { pick: { pool: ['reit', 'trans', 'oil', 'mat', 'disc', 'ecom', 'green', 'space'], f: 0.80 } }),
  Object.assign(EV(L('Stock split', '大型股拆股'), L('One share becomes several cheaper ones. The company is worth exactly the same; more small investors trade it, so the price gets a short-lived lift.', '一股拆成好幾股,每股變便宜。公司價值完全沒變,只是更多小資族來交易,股價短暫小漲。拆股不會讓公司憑空變值錢。'), {}),
    { pick: { pool: ['tech', 'soft', 'chip', 'fin', 'staples', 'health', 'ecom', 'game'], f: 1.05 } }),
  Object.assign(EV(L('Special dividend', '特別股利'), L('The company pays out a one-time cash bonus. Holders get the cash, but the share price drops by the same amount: the money just moves from the company to your pocket.', '公司一次發一大筆現金股利。股東拿到現金,但股價會扣掉同樣的金額(除息):錢只是從公司搬到你的口袋。'), {}),
    { pick: { pool: ['tech', 'chip', 'yield', 'oil', 'health', 'reit', 'fin', 'staples', 'util', 'mat', 'def'], f: 0.94, payout: 0.06 } }),
  Object.assign(EV(L('Insiders buy shares', '內部人買進自家股票'), L('Executives buy their own company\'s shares with their own money. The market reads it as confidence.', '公司高層自掏腰包買自家股票,市場解讀成經營層有信心。'), {}), { pick: { f: 1.05 } }),
  Object.assign(EV(L('Insiders dump shares', '內部人大量賣股'), L('Executives sell a big block of their shares. They may just need cash, but the market worries they know something.', '公司高層大量賣出持股。也許只是需要用錢,但市場擔心他們看壞公司。'), {}), { pick: { f: 0.95 } }),
  Object.assign(EV(L('Short-seller report published', '空頭報告發布'), L('A short seller publishes a report accusing the company of problems, and the stock plunges. Whether the report is right only shows next round: if the claims fall apart, most of the drop comes back.', '放空機構發布報告指控這家公司有問題,股價重挫。報告說得對不對,下一回合才知道:如果查無實據,跌掉的會漲回一大半。'), {}),
    { pick: { f: 0.78, rebound: 0.7, reboundP: 0.5 }, afterW: L('The short report\'s claims did not hold up, so most of the drop came back.', '空頭報告的指控查無實據,跌掉的漲回一大半。') }),
  // ── 監管、專利、訴訟 ──
  Object.assign(EV(L('Regulators open an investigation', '監管調查啟動'), L('Regulators start investigating the company. Nothing is proven yet, but uncertainty alone pushes the price down.', '主管機關對這家公司展開調查。還沒定罪,但光是不確定性就讓股價下跌。'), {}),
    { pick: { pool: ['tech', 'soft', 'fin', 'bio', 'ecom', 'health', 'game'], f: 0.88 } }),
  Object.assign(EV(L('Patent lawsuit won', '專利訴訟勝訴'), L('A court rules the company\'s patent was infringed. Rivals must pay royalties or stop selling.', '法院判決這家公司的專利被侵權,對手得付權利金或停止銷售。'), {}), { pick: { pool: ['tech', 'chip', 'bio', 'soft', 'robot'], f: 1.15 } }),
  Object.assign(EV(L('Patent lawsuit lost', '專利訴訟敗訴'), L('A court rules the company infringed someone else\'s patent. It must pay damages and may have to stop selling a product.', '法院判決這家公司侵犯別人的專利,要賠錢,產品還可能被迫下架。'), {}), { pick: { pool: ['tech', 'chip', 'bio', 'soft', 'robot'], f: 0.85 } }),
  Object.assign(EV(L('Key patent expires', '關鍵專利到期'), L('Protection on a best-selling product ends and cheaper copies flood in. Profits that looked permanent were only rented.', '暢銷產品的專利保護到期,便宜的仿製品湧進市場。看似穩定的獲利,其實只是租來的。'), {}), { pick: { pool: ['bio', 'health', 'tech', 'chip'], f: 0.85 } }),
  EV(L('Data privacy law tightens', '資料隱私法收緊'), L('New rules limit how companies collect and use personal data. Businesses built on ads and user data earn less.', '新法限制企業蒐集和使用個資,靠廣告和用戶資料賺錢的生意變難做。'),
    { ecom: 0.90, soft: 0.92, tech: 0.94, game: 0.96 }),
  EV(L('AI rules relaxed', 'AI 法規放寬'), L('Governments ease the rules on building and selling AI. Robots, software and chips can ship faster: the mirror image of a big tech crackdown.', '政府放寬 AI 開發和上市的規定,機器人、軟體、晶片都能更快推出,和「大型科技監管法案」正好相反。'),
    { robot: 1.12, soft: 1.12, chip: 1.10, tech: 1.06 }),
  // ── 營運中斷、供應鏈、能源 ──
  Object.assign(EV(L('Ransomware attack', '大型駭客勒索事件'), L('Hackers lock the company\'s systems and demand a ransom, so its factories and services stop. Unlike a data leak, the business itself grinds to a halt.', '駭客鎖住這家公司的系統勒索贖金,工廠和服務全部停擺。和個資外洩不同,這是營運直接中斷。'), { fin: 0.97, soft: 0.97 }),
    { pick: { f: 0.85 } }),
  EV(L('Supplier factory fire', '供應商工廠大火停產'), L('A fire shuts a key parts factory. The few parts left get pricier, and everyone who builds with them pays more or waits.', '關鍵零件廠失火停產。剩下的零件變搶手、變貴,用這些零件的下游不是多付錢就是等貨。'),
    { chip: 1.08, tech: 0.95, robot: 0.95, green: 0.95, game: 0.97, space: 0.97 }),
  EV(L('Raw material prices crash', '原料價格暴跌'), L('Steel, copper and other materials fall fast. Miners and mills lose, while manufacturers and shops pay less for what they build and sell.', '鋼鐵、銅等原料價格快速下跌。礦業和鋼廠受傷,製造業和零售的成本則降低。'),
    { mat: 0.80, oil: 0.95, robot: 1.04, tech: 1.03, staples: 1.04, ecom: 1.03, trans: 1.03 }),
  EV(L('OPEC boosts output', 'OPEC 大幅增產'), L('Oil producers pump much more. Cheap fuel helps airlines, shippers and shoppers; energy companies and electric cars lose some appeal.', '產油國大幅增產,油價下跌。便宜的燃料幫了航空、航運和消費者;能源股受傷,電動車的吸引力也降低。'),
    { oil: 0.80, trans: 1.10, disc: 1.06, ecom: 1.03, staples: 1.02, green: 0.95 }),
  EV(L('Natural gas prices soar', '天然氣價格暴漲'), L('Gas for power plants and factories gets expensive. Energy producers gain; utilities, chemical makers and farms (fertilizer) pay more.', '發電廠和工廠用的天然氣變貴。能源業受惠;電力公司、化工和農業(肥料)的成本上升。'),
    { oil: 1.12, util: 0.92, mat: 0.94, staples: 0.97, agri: 0.97 }),
  EV(L('Massive grid blackout', '電網大停電'), L('A huge blackout stops data centers, fabs and factories. Investment in grids, batteries and green power suddenly looks urgent.', '大範圍停電讓資料中心、晶圓廠、工廠停擺,強化電網、儲能和綠電的投資突然變得急迫。'),
    { chip: 0.92, tech: 0.94, robot: 0.94, mat: 0.95, green: 1.10, util: 1.05 }),
  EV(L('Satellite collision', '衛星碰撞事故'), L('Two satellites collide and scatter debris across busy orbits. Space firms face higher insurance and stricter rules, a different risk from a failed launch.', '兩顆衛星相撞,碎片散布在繁忙的軌道上。太空公司的保險費和監管都變嚴,和火箭發射失敗是不同的風險。'),
    { space: 0.80, fin: 0.98 }),
  EV(L('Defense budget jumps', '政府國防預算大增'), L('Governments raise military spending. Defense contractors, space firms and chip makers win orders; more borrowing weighs a little on bonds.', '各國提高國防支出,軍工、太空和晶片廠拿到訂單;政府多借錢,債券小跌。'),
    { def: 1.20, space: 1.12, chip: 1.04, bond: 0.98 }),
];
// 牌組平衡:原本每檔資產在整副牌裡的漲跌不對稱(黃金平均每張 +3.5%、金融 −4.5%),玩越久越固定往一邊走,
// 看懂牌組的人(或電腦)只要固定做多 / 放空就贏。這裡在載入時把每檔資產調成「整副牌的漲跌互相抵消」(幾何平均 = 1):
//   上漲的卡 log 漲幅 × s、下跌的卡 ÷ s,s = √(−下跌總和 / 上漲總和) → 每張卡的方向不變,只有幅度變
//   黑色星期一的「下回合反彈」也算進去;單張卡被放大時不超過 −22% / +25%(加密貨幣 −40% / +40%),原本就更大的不動
//   大盤 ETF 用平衡後的股票類股平均重算,再平衡一次。迷因股軋空是抽到才決定的,不算
{
  const deck = EVENTS.filter((e) => !e.meme && !e.divUp && !e.divCut), eq = KEYS.filter((k) => !NON_EQUITY.has(k));
  const eff = (e, k) => { let l = Math.log(e.m[k]); if (e.rebound && e.m[k] < 1) l += Math.log(1 + (1 / e.m[k] - 1) * e.rebound); return l; };
  const balance = (k) => {
    const [lo, hi] = k === 'crypto' ? [0.6, 1.4] : [0.78, 1.25];
    for (let it = 0; it < 60; it++) {
      let up = 0, dn = 0; for (const e of deck) { const l = eff(e, k); if (l > 0) up += l; else dn += l; }
      if (up <= 0 || dn >= 0) return;
      const s = Math.sqrt(-dn / up); if (Math.abs(s - 1) < 1e-5) return;
      for (const e of deck) { const l = Math.log(e.m[k]);
        if (l > 0) e.m[k] = Math.min(Math.max(hi, e.m[k]), Math.exp(l * s)); else if (l < 0) e.m[k] = Math.max(Math.min(lo, e.m[k]), Math.exp(l / s)); }
    }
  };
  for (const k of KEYS) if (k !== 'etf') balance(k);
  for (const e of deck) e.m.etf = eq.reduce((a, k) => a + e.m[k], 0) / eq.length;
  balance('etf');
}
const ONES = Object.fromEntries(KEYS.map((k) => [k, 1]));
const BAIL = 1000, JAIL_WAIT = 3;         // 警察局:休息 JAIL_WAIT 回合才能出來,或付保釋金 BAIL 直接出來(出來都要擲一顆骰子決定走幾格)
const LANE_LEN = 6;                       // 警察局 / 內部認購出來的小路有幾格(定義在 LANES)
// 內部認購(私募):一進攤位公司先送 IPO_FREE 股(免費、馬上可以賣);想多買再用市價 8 折認購,一定買得到,
// 但加碼認購的股數有閉鎖期 IPO_LOCK 回合不能賣(台灣私募價格不得低於參考價 8 成,且有轉讓限制)
const IPO_OFF = 0.8, IPO_LOCK = 3, IPO_FREE = 10;
// 銀行:走到銀行格可以借現金(最多欠 BANK_MAX),每次經過起點付欠款 5% 的利息;欠的錢會從總資產扣掉
const BANK_MAX = 5000, BANK_RATE = 0.05;
// 大盤長期趨勢:股票類股和大盤 ETF 每回合平均多漲 1%(20 回合約 +22%)。事件卡平衡過、長期是平的,這一項讓「長期投資股票」比放現金好
// 棋盤裡面的兩個特殊格:警察局、IPO 攤位(各一格 cell),離開時擲一顆骰子,沿著 6 格的小路(path)走回外圈;
// 走過最後一格就踩上外圈的 exit 那格,多的點數繼續往前走。小路上每一格是什麼(命運、道具、利息…)每次有人進來都重新隨機生成。座標是格網的 [x, z]
// 兩條小路都是「從裡面直直走出來」:警察局在後面(z=4 那排),往左邊的外圈走;內部認購攤位在前面(z=14 那排),往右邊的外圈走
const LANES = {
  jail: { exit: 32, cell: [7, 4], path: [[6, 4], [5, 4], [4, 4], [3, 4], [2, 4], [1, 4]] },
  ipo: { exit: 68, cell: [11, 14], path: [[12, 14], [13, 14], [14, 14], [15, 14], [16, 14], [17, 14]] },
};
// 小路格子的種類:第 3 格固定是市場事件,其他 5 格就是池子裡這 5 種,每次隨機排(沒有空格;命運只在外圈)。
// 警察局那條:被扣留時看著市場新聞,多一格市場事件、還有手續費;內部認購那條:VIP 攤位,禮物和撿到錢多
const PATH_POOL = { jail: ['gift', 'fee', 'coin', 'interest', 'chance'], ipo: ['gift', 'gift', 'interest', 'coin', 'coin'] };
const PATH_FIXED = { jail: { 2: 'chance' }, ipo: { 2: 'chance' } };      // 固定位置的格子:兩條小路第 3 格一定是市場事件
const MARKET_DRIFT = 0.01;
const DIV_STEP = 0.01, DIV_MAX = 0.08, DIV_MIN = 0.005, DIV_UP_PRICE = 1.04, DIV_CUT_PRICE = 0.92;   // 調高股利:每次 +1 個百分點、最多 8%、股價 +4%
const LOT = 10, START_CASH = 10000, SALARY = 1000, FEE = 200, MAX_ROLLS = 20;
const DIV_ROUND = 0.25;   // 股利每一回合配一次(每回合配年率的 1/4),不用等繞回起點;命運牌「特別股利」另外多配一次全額
const REMOTE_PRICE = 300, CARD_PRICE = 500, ATK_PRICE = 600, ATK_DROP = 0.82, SPY_PRICE = 400, SPY_ROUNDS = 3, DICE3_PRICE = 350;
const SALE_EVENTS = [0, 1, 2, 4, 6, 7, 8, 11, 12, 14, 16, 17, 20, 21, 61, 64, 65, 68, 69, 75, 104, 108, 112];    // 商店 / 禮物會出的事件卡(EVENTS 的編號,只有好消息類)
const ITEM_IDS = ['remote', 'atk', 'spy', 'dice3'];                       // 道具;商店每次必有其中一樣
const MARGIN_LOAN = 0.6, MAINT = 1.3, MARGIN_FEE = 0.02;
const SQUEEZE = 1.3;
const buyF = (n) => 1 + 0.004 * n, sellF = (n) => Math.max(0.85, 1 - 0.003 * n), shortF = (n) => Math.max(0.8, 1 - 0.005 * n), SHORT_F = shortF(LOT);   // 放空每股壓低 0.5%(最多 -20%)
const FATE = [
  { id: 'lottery', good: true, t: L('You won the lottery', '中樂透'), w: L('Pure luck. Luck is not a strategy, but take it.', '純運氣。運氣不是策略,但該拿還是拿。'), fx: L('+$1,500', '+$1,500') },
  { id: 'tax', good: false, t: L('Tax season', '報稅季'), w: L('Profits get taxed. Keep some cash for it.', '賺的錢要繳稅,手上要留一點現金。'), fx: L('−5% of your cash', '現金 −5%') },
  { id: 'birthday', good: true, t: L('Birthday', '生日'), w: L('Every other player chips in.', '其他每位玩家各包一個紅包給你。'), fx: L('+$200 from each player', '每人給你 +$200') },
  { id: 'gostart', good: true, t: L('Shortcut to GO', '抄捷徑回起點'), w: L('Collect your salary early.', '提早領薪水。'), fx: L('Move to GO', '直接移到起點') },
  { id: 'fat', good: false, t: L('Fat-finger trade', '不小心按錯'), w: L(`You tapped the wrong button and sold ${LOT} shares of a random holding at market price. Double-check before you confirm.`, `手滑按錯鍵,把隨機一檔持股用市價賣掉了 ${LOT} 股。下單前要再看一眼。`), fx: L(`Sell ${LOT} shares of one holding`, `隨機一檔持股賣出 ${LOT} 股`) },
  { id: 'swap', good: true, t: L('Teleport', '瞬間移動'), w: L('You swap places with a random rival. Wherever you land, you land.', '和隨機一位對手互換位置。換到哪一格,就算踩到那一格。'), fx: L('Swap places with a rival', '和一位對手互換位置') },
  { id: 'ipo', good: true, t: L('Private placement invite', '受邀內部認購'), w: L(`A company gives you ${IPO_FREE} free shares and offers more at 20% off (those cannot be sold for a while).`, `有公司送你 ${IPO_FREE} 股,還能用市價 8 折加碼認購(加碼的一段時間不能賣)。`), fx: L('Go to the placement booth', '前往內部認購攤位') },
  { id: 'jail', good: false, t: L('Insider trading probe', '涉嫌內線交易'), w: L(`Trading on information the public does not have is illegal. Rest ${JAIL_WAIT} rounds at the police station, or pay $${fmt(BAIL)} bail.`, `用還沒公開的消息買賣股票是違法的。到警察局休息 ${JAIL_WAIT} 回合,或付 $${fmt(BAIL)} 保釋金。`), fx: L('Go to the police station', '前往警察局') },
  { id: 'remote', good: true, t: L('Found a remote dice', '撿到遙控骰子'), w: L('A dice you can set. It is in your backpack.', '可以指定點數的骰子,放進背包了。'), fx: L('+1 Remote dice', '+1 遙控骰子') },
  { id: 'atk', good: true, t: L('A rumor to spread', '聽到一個八卦'), w: L('A bad-news card for your backpack. Use it on a rival.', '一張利空消息卡進背包,拿去打對手。'), fx: L('+1 Bad news card', '+1 利空消息卡') },
  { id: 'divi', good: true, t: L('Special dividend', '特別股利'), w: L('All your holdings pay out once, right now.', '你所有持股立刻配息一次。'), fx: L('Dividends now', '立刻領一次股利') },
  { id: 'phone', good: false, t: L('Dropped your phone', '手機掉進水裡'), w: L('Life happens. Emergency fund matters.', '生活總有意外,所以要有緊急預備金。'), fx: L('−$300', '−$300') },
  { id: 'richest', good: true, t: L('The leader treats', '第一名請客'), w: L('The richest other player buys you dinner.', '最有錢的對手請你吃飯。'), fx: L('+$500 from the leader', '第一名給你 +$500') },
  { id: 'fine', good: false, t: L('Parking ticket', '違規停車罰單'), w: L('Small, annoying, unavoidable.', '小錢,但很煩。'), fx: L('−$500', '−$500') },
  { id: 'salary2', good: true, t: L('Promotion', '升職加薪'), w: L('Your next salary is doubled.', '下一次經過起點薪水加倍。'), fx: L('Next salary ×2', '下次薪水 ×2') },
];
return { LANES, PATH_POOL, PATH_FIXED, MARKET_DRIFT, DIV_STEP, DIV_MAX, DIV_MIN, DIV_UP_PRICE, DIV_CUT_PRICE, SECTORS, KEYS, N, TILES, TILE_COLOR, NON_EQUITY, EV, EVENTS, ONES, BAIL, JAIL_WAIT, LANE_LEN, IPO_OFF, IPO_LOCK, IPO_FREE, BANK_MAX, BANK_RATE, LOT, START_CASH, SALARY, FEE, MAX_ROLLS, DIV_ROUND, FATE, MARGIN_LOAN, MAINT, MARGIN_FEE, SQUEEZE, buyF, sellF, shortF, SHORT_F, REMOTE_PRICE, CARD_PRICE, ATK_PRICE, ATK_DROP, SPY_PRICE, SPY_ROUNDS, DICE3_PRICE, SALE_EVENTS, ITEM_IDS };
}
