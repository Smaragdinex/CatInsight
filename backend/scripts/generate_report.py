#!/usr/bin/env python3
"""
Generate a fresh 20-slide 期末報告 in plain Chinese.
Uses the original PPTX to inherit the slide master (dark background/fonts).
"""

from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
from lxml import etree

PPTX_IN  = './reports/期末報告.pptx'
PPTX_OUT = './reports/期末報告_final.pptx'

# ── Colors ────────────────────────────────────────────────────────────────────
BG      = "0B0C23"
CARD    = "321A2C"
CARD_M  = "6D4562"
ACCENT  = "A95B95"
TITLE_C = "C6BFEE"
BODY_C  = "DAD8E9"
GREEN   = "6FCF97"
RED     = "EB5757"
WARN    = "F2C94C"
WHITE   = "FFFFFF"
DIM     = "8A7FA0"

# ── Fonts ─────────────────────────────────────────────────────────────────────
FT = "Prompt Medium"
FB = "Mukta Light"

NSP = 'http://schemas.openxmlformats.org/presentationml/2006/main'
NSA = 'http://schemas.openxmlformats.org/drawingml/2006/main'
NSR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

# ── Slide dimensions ──────────────────────────────────────────────────────────
SW, SH = 9144000, 5143500   # 10 × 5.625 inches
LM = 550000                  # left margin
RM = 8700000                 # right edge

# ── XML shape builder ─────────────────────────────────────────────────────────
def sp(x, y, cx, cy, sid, name,
       fill=None, no_fill=False, prst='rect', adj=None,
       paragraphs=None, wrap='square', anchor='t', inset=45720):

    if adj is not None:
        geom = f'<a:prstGeom prst="{prst}"><a:avLst><a:gd name="adj" fmla="val {adj}"/></a:avLst></a:prstGeom>'
    else:
        geom = f'<a:prstGeom prst="{prst}"><a:avLst/></a:prstGeom>'

    fill_xml = ('<a:noFill/>' if no_fill else
                f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>' if fill else '<a:noFill/>')

    def safe(t):
        return str(t).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

    para_xml = ''
    if paragraphs:
        for para in paragraphs:
            align = para.get('align', 'l')
            spc   = para.get('spacing')
            lnspc = para.get('lnspc')
            spc_x  = f'<a:spcBef><a:spcPts val="{spc}"/></a:spcBef>' if spc else ''
            lns_x  = f'<a:lnSpc><a:spcPct val="{lnspc}"/></a:lnSpc>' if lnspc else ''
            runs = ''
            for r in para.get('runs', []):
                t    = safe(r.get('text',''))
                font = r.get('font', FB)
                sz   = int(round(r.get('pt', 9) * 100))
                col  = r.get('color', BODY_C)
                b    = ' b="1"' if r.get('bold') else ''
                runs += (f'<a:r><a:rPr lang="zh-TW" sz="{sz}" dirty="0"{b}>'
                         f'<a:solidFill><a:srgbClr val="{col}"/></a:solidFill>'
                         f'<a:latin typeface="{font}" pitchFamily="34" charset="0"/>'
                         f'<a:ea typeface="{font}" pitchFamily="34" charset="-122"/>'
                         f'<a:cs typeface="{font}" pitchFamily="34" charset="-120"/>'
                         f'</a:rPr><a:t>{t}</a:t></a:r>')
            para_xml += (f'<a:p><a:pPr algn="{align}"><a:buNone/>{spc_x}{lns_x}</a:pPr>'
                         f'{runs}</a:p>')
        txb = (f'<p:txBody>'
               f'<a:bodyPr wrap="{wrap}" lIns="{inset}" tIns="{inset}" '
               f'rIns="{inset}" bIns="{inset}" rtlCol="0" anchor="{anchor}"/>'
               f'<a:lstStyle/>{para_xml}</p:txBody>')
    else:
        txb = ''

    xml = (f'<p:sp xmlns:p="{NSP}" xmlns:a="{NSA}">'
           f'<p:nvSpPr><p:cNvPr id="{sid}" name="{name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
           f'<p:spPr>'
           f'<a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
           f'{geom}{fill_xml}<a:ln><a:noFill/></a:ln>'
           f'</p:spPr>{txb}</p:sp>')
    return etree.fromstring(xml)


def add(slide, elements):
    tree = slide.shapes._spTree
    for el in elements:
        tree.append(el)


def T(text, font=FB, pt=9, color=BODY_C, bold=False):
    return {'text': text, 'font': font, 'pt': pt, 'color': color, 'bold': bold}

def P(*runs, align='l', spacing=None, lnspc=None):
    return {'runs': list(runs), 'align': align, 'spacing': spacing, 'lnspc': lnspc}


def header(slide, title, badge, desc, sid=1, desc2=None):
    """Standard slide header: title + badge + description."""
    paras = [P(T(desc, FB, 9, BODY_C))]
    if desc2:
        paras.append(P(T(desc2, FB, 9, BODY_C)))
    add(slide, [
        sp(LM, 160000, 8100000, 340000, sid,   'Title',
           no_fill=True,
           paragraphs=[P(T(title, FT, 21, TITLE_C))]),
        sp(LM, 560000, 980000,  130000, sid+1, 'Badge',
           fill=ACCENT, prst='roundRect', adj=16667,
           paragraphs=[P(T(badge, FB, 6.5, BODY_C), align='c')], anchor='ctr'),
        sp(LM, 730000, 8100000, 250000, sid+2, 'Desc',
           no_fill=True, inset=0,
           paragraphs=paras),
    ])


def divider(slide, y, sid):
    add(slide, [sp(LM, y, RM-LM, 30000, sid, 'Divider', fill=CARD_M)])


# ── Slide factories ───────────────────────────────────────────────────────────

def s01_title(slide):
    """標題頁"""
    add(slide, [
        # Accent bar
        sp(0, 0, 350000, SH, 1, 'AccentBar', fill=ACCENT),
        # Main title
        sp(450000, 1600000, 8200000, 700000, 2, 'MainTitle',
           no_fill=True, inset=0,
           paragraphs=[P(T('股票買賣預測系統', FT, 36, TITLE_C), align='c')]),
        # Subtitle
        sp(450000, 2380000, 8200000, 280000, 3, 'Sub',
           no_fill=True, inset=0,
           paragraphs=[P(T('用機器學習分析技術指標，預測隔日買進時機', FB, 13, BODY_C), align='c')]),
        # Separator line
        sp(2500000, 2750000, 4200000, 25000, 4, 'Sep', fill=CARD_M),
        # Team
        sp(450000, 2900000, 8200000, 500000, 5, 'Team',
           no_fill=True, inset=0,
           paragraphs=[
               P(T('軟創三  賴思翰  512171258   ·   軟創二  李良薇  513170524   ·   軟創三  林佳誼  512172020',
                   FB, 9, DIM), align='c'),
           ]),
    ])


def s02_problem(slide):
    """我們想解決什麼問題"""
    header(slide, '我們想解決什麼問題？', 'MOTIVATION',
           '股票每天都在漲跌。有沒有辦法從過去的技術資料，判斷「明天值不值得買」？')
    add(slide, [
        # Left: problem statement
        sp(LM, 1050000, 3800000, 3600000, 10, 'ProbCard', fill=CARD,
           paragraphs=[
               P(T('傳統做法的問題', FT, 11, TITLE_C), spacing=0),
               P(T('', FB, 6, BODY_C)),
               P(T('• 看圖憑感覺，主觀判斷', FB, 9, BODY_C)),
               P(T('• 無法同時分析多個指標', FB, 9, BODY_C)),
               P(T('• 看了很多指標，還是不知道什麼時候買', FB, 9, BODY_C)),
               P(T('', FB, 4, BODY_C)),
               P(T('我們的目標', FT, 11, TITLE_C)),
               P(T('', FB, 6, BODY_C)),
               P(T('• 系統化地分析多個技術指標', FB, 9, BODY_C)),
               P(T('• 給出明確的「買」或「不買」判斷', FB, 9, BODY_C)),
               P(T('• 用歷史資料驗證準不準', FB, 9, BODY_C)),
           ], anchor='t', inset=60000),
        # Right: our answer
        sp(4550000, 1050000, 4150000, 3600000, 11, 'AnsCard', fill=CARD,
           paragraphs=[
               P(T('我們的解法', FT, 11, TITLE_C), spacing=0),
               P(T('', FB, 6, BODY_C)),
               P(T('XGBoost 分類模型', FT, 14, TITLE_C)),
               P(T('', FB, 4, BODY_C)),
               P(T('輸入：20 天的技術面與市場資料（50 個特徵）', FB, 9, BODY_C)),
               P(T('', FB, 4, BODY_C)),
               P(T('輸出：Buy  /  NotBuy', FT, 13, GREEN)),
               P(T('', FB, 4, BODY_C)),
               P(T('驗證：排除未來資訊的時間序列回測', FB, 9, BODY_C)),
           ], anchor='t', inset=60000),
    ])


def s03_data(slide):
    """資料從哪裡來"""
    header(slide, '資料從哪裡來？', 'DATA COLLECTION',
           '從 Yahoo Finance 下載 6 年的每日交易資料，涵蓋 16 檔股票與市場指標。')
    # 3 stat boxes
    stats = [
        ('6 年', '資料時間範圍', '2019 年 1 月 ～ 2025 年底'),
        ('16 檔', '股票 + 市場指標', '11 個個股 + SPY / QQQ / SOXX / VIX / TSLA'),
        ('22,000+', '訓練樣本數', '每檔每天一筆，含技術指標'),
    ]
    for i, (val, lbl, sub) in enumerate(stats):
        bx = LM + i * 2720000
        add(slide, [
            sp(bx, 1050000, 2600000, 800000, 20+i*3, f'Stat{i}', fill=CARD,
               paragraphs=[
                   P(T(val,  FT, 26, TITLE_C), align='c', lnspc='85000'),
                   P(T(lbl,  FT, 10, TITLE_C), align='c'),
                   P(T(sub,  FB,  7.5, BODY_C), align='c'),
               ], anchor='ctr'),
        ])

    # Stock list
    stocks_left = ['AAPL  ·  Apple', 'AVGO  ·  博通', 'GOOGL  ·  Alphabet', 'LITE  ·  Lumentum',
                   'MRVL  ·  Marvell', 'MU  ·  Micron']
    stocks_right = ['NFLX  ·  Netflix', 'NVDA  ·  輝達', 'SNDK  ·  SanDisk',
                    'STX  ·  希捷', 'TSM  ·  台積電']
    mkt = ['SPY（大盤）', 'QQQ（那斯達克）', 'SOXX（半導體ETF）', 'VIX（恐慌指數）', 'TSLA（高波動代表）']

    def stock_paras(items, title):
        paras = [P(T(title, FT, 9, TITLE_C))]
        for s in items:
            paras.append(P(T(f'  {s}', FB, 8.5, BODY_C)))
        return paras

    add(slide, [
        sp(LM,      1950000, 2600000, 2900000, 30, 'SL', fill=CARD,
           paragraphs=stock_paras(stocks_left, '個股（1/2）'), inset=50000),
        sp(3270000, 1950000, 2400000, 2900000, 31, 'SR', fill=CARD,
           paragraphs=stock_paras(stocks_right, '個股（2/2）'), inset=50000),
        sp(5780000, 1950000, 2920000, 2900000, 32, 'SM', fill=CARD,
           paragraphs=stock_paras(mkt, '市場指標'), inset=50000),
    ])


def s04_noise(slide):
    """資料清洗：三層雜訊過濾"""
    header(slide, '資料清洗：三層雜訊過濾', 'DATA CLEANING',
           '對應老師講義：看到可疑資料不要直接刪，要先判斷原因、有理由才移除。我們設計了三道關卡。')

    layers = [
        ('第一層', '抓資料時', CARD_M, [
            '• 移除收盤價為空的資料列',
            '• 排除歷史不足 35 天的股票',
            '• 跳過前 25 個交易日（指標暖機期）',
            '  → RSI / MACD 前幾天的值不穩定，不應訓練',
        ]),
        ('第二層', '品質報告過濾', CARD, [
            '• 移除 symbol / date / close / high / low / volume 任一缺失',
            '• close、high、low 必須 > 0',
            '• volume >= 0',
            '• RSI 必須在 0～100 之間',
            '• MFI 必須在 0～100 之間',
        ]),
        ('第三層', '訓練時過濾', CARD_M, [
            '• 20 日視窗內有任何 NaN 的樣本跳過',
            '• 報酬序列不足 3 筆的跳過',
            '• 當日收盤價 ≤ 0 的跳過',
            '  → 確保特徵計算的數值完整可信',
        ]),
    ]

    for i, (num, title, bg, bullets) in enumerate(layers):
        bx = LM + i * 2750000
        paras = [
            P(T(num, FB, 7.5, ACCENT), T(f'  {title}', FT, 11, TITLE_C)),
            P(T('', FB, 5, BODY_C)),
        ]
        for b in bullets:
            col = BODY_C if not b.startswith('  →') else DIM
            paras.append(P(T(b, FB, 8.5, col)))
        add(slide, [
            sp(bx, 1050000, 2630000, 3750000, 40+i*2, f'Layer{i}', fill=bg,
               paragraphs=paras, inset=60000),
        ])


def s05_indicators(slide):
    """技術指標計算"""
    header(slide, '我們計算了哪些技術指標？', 'TECHNICAL INDICATORS',
           '原始的收盤價只能看出今天漲或跌，沒辦法告訴我們「趨勢」和「動能」。所以我們先計算技術指標。')

    indicators = [
        ('RSI 14', '相對強弱指標', '衡量近 14 天的漲跌力道，> 70 超買，< 30 超賣。數值在 0～100。'),
        ('MFI 14', '資金流量指標', '加入成交量的 RSI，判斷資金是在流入還是流出股票。'),
        ('MACD',   '均線收斂擴散', '短期均線（12日）與長期均線（26日）的差值，加上 9 日訊號線。'),
        ('OBV',    '能量潮指標',   '根據成交量累積計算，上漲日加量、下跌日減量，反映籌碼方向。'),
        ('MA5',    '5 日移動平均',  '最近 5 天的平均收盤價，當價格在 MA5 上方代表短期強勢。'),
    ]

    for i, (name, full, desc) in enumerate(indicators):
        iy = 1050000 + i * 760000
        add(slide, [
            sp(LM, iy, 1100000, 680000, 50+i*3, f'IName{i}',
               fill=CARD_M,
               paragraphs=[
                   P(T(name, FT, 13, TITLE_C), align='c'),
                   P(T(full, FB, 7,  BODY_C),  align='c'),
               ], anchor='ctr'),
            sp(1750000, iy+30000, 6800000, 620000, 51+i*3, f'IDesc{i}',
               no_fill=True, inset=0,
               paragraphs=[P(T(desc, FB, 9, BODY_C))]),
        ])


def s06_features(slide):
    """我們用了 50 個特徵"""
    header(slide, '我們用了 50 個特徵', 'FEATURE ENGINEERING',
           '把技術指標轉成模型可以理解的數字。共 4 大類，50 個特徵。')

    cats = [
        ('動能 & 報酬', GREEN, [
            'lag_1/2/3 日報酬率',
            '5/20 日平均報酬',
            '20 日動量（momentum）',
            '20 日波動率',
        ]),
        ('均線 & RSI/MFI', TITLE_C, [
            'RSI、MFI（原值 + 正規化）',
            'RSI / MFI 3 日變化',
            'MA5 / MA20 偏離率',
            'OBV 5 日變化',
        ]),
        ('MACD & 成交量', WARN, [
            'MACD 值、訊號線、柱狀圖',
            'MACD 柱狀 3 日變化',
            '成交量比例（今日 / 20日均）',
            '20 日平均成交量',
        ]),
        ('市場環境', ACCENT, [
            'SPY / QQQ / SOXX 當日報酬',
            'VIX 變化、VIX 水準',
            '個股相對強弱（vs SPY / SOXX）',
            '大盤 RSI / MACD 柱狀',
        ]),
    ]

    for i, (title, col, items) in enumerate(cats):
        bx = LM + (i % 2) * 4100000
        by = 1050000 + (i // 2) * 1900000
        paras = [P(T(title, FT, 10, col), spacing=0), P(T('', FB, 5, BODY_C))]
        for it in items:
            paras.append(P(T(f'• {it}', FB, 8.5, BODY_C)))
        add(slide, [
            sp(bx, by, 3900000, 1750000, 60+i*2, f'Cat{i}', fill=CARD,
               paragraphs=paras, inset=55000),
        ])


def s07_rf_vs_xgb(slide):
    """一開始我們用隨機森林"""
    header(slide, '一開始我們用隨機森林——結果不夠好', 'RANDOM FOREST → XGBOOST',
           '第一版模型用隨機森林，準確率 51.4%，Buy 精確率只有 42.5%。模型太保守，幾乎把所有訊號都預測成 NotBuy。')

    rows = [
        ('',              'Random Forest',  'XGBoost',       '改善'),
        ('整體準確率',    '51.4%',          '64.2%',         '+12.8%'),
        ('Macro F1 分數', '49.4%',          '56.4%',         '+7.0%'),
        ('Buy 精確率',    '42.5%',          '60.9%',         '+18.4%'),
        ('學習方式',      '多棵樹各自獨立訓練後投票', '逐步修正每棵樹的錯誤', '—'),
        ('對弱訊號的敏感度', '較保守，容易平均化', '更能放大有效訊號', '—'),
    ]

    col_widths = [2200000, 2200000, 2200000, 1400000]
    col_starts = [LM]
    for w in col_widths[:-1]:
        col_starts.append(col_starts[-1] + w + 20000)

    for ri, row in enumerate(rows):
        ry = 1050000 + ri * 620000
        bg = CARD_M if ri == 0 else (CARD if ri % 2 == 1 else "261629")
        add(slide, [sp(LM, ry, sum(col_widths)+60000, 580000, 70+ri, f'RowBg{ri}', fill=bg)])
        for ci, (val, cx, cw) in enumerate(zip(row, col_starts, col_widths)):
            col = BODY_C
            if ri == 0:
                col = TITLE_C
            elif ci == 2 and ri >= 1 and ri <= 3:
                col = GREEN
            elif ci == 3 and ri >= 1 and ri <= 3:
                col = GREEN
            add(slide, [
                sp(cx+20000, ry, cw-40000, 580000, 71+ri*10+ci, f'Cell{ri}_{ci}',
                   no_fill=True, inset=20000,
                   paragraphs=[P(T(val, FT if ci==0 or ri==0 else FB,
                                   9 if ri>0 else 8.5, col), align='c')],
                   anchor='ctr'),
            ])


def s08_label(slide):
    """怎麼決定「要不要買」"""
    header(slide, '怎麼決定「要不要買」？', 'LABEL DESIGN',
           '我們把問題簡化成二分類：隔天漲超過 1.5% 就叫「Buy」，其餘叫「NotBuy」。')

    add(slide, [
        # Flow: current day → calc return → label
        sp(LM, 1050000, 2300000, 1200000, 80, 'F1', fill=CARD_M,
           paragraphs=[
               P(T('今日收盤價', FB, 8.5, BODY_C), align='c'),
               P(T('Close_t', FT, 12, TITLE_C), align='c'),
           ], anchor='ctr'),
        sp(2950000, 1050000, 2300000, 1200000, 81, 'F2', fill=CARD_M,
           paragraphs=[
               P(T('隔日收盤價', FB, 8.5, BODY_C), align='c'),
               P(T('Close_(t+1)', FT, 12, TITLE_C), align='c'),
           ], anchor='ctr'),
        sp(5500000, 1050000, 3050000, 1200000, 82, 'F3', fill=CARD_M,
           paragraphs=[
               P(T('隔日報酬率', FB, 8.5, BODY_C), align='c'),
               P(T('(Close_(t+1) / Close_t) - 1', FB, 9, TITLE_C), align='c'),
           ], anchor='ctr'),
        # Arrows (text)
        sp(2400000, 1350000, 500000, 400000, 83, 'Arr1', no_fill=True, inset=0,
           paragraphs=[P(T('→', FT, 20, ACCENT), align='c')]),
        sp(4900000, 1350000, 500000, 400000, 84, 'Arr2', no_fill=True, inset=0,
           paragraphs=[P(T('→', FT, 20, ACCENT), align='c')]),

        # Labels
        sp(LM, 2450000, 3800000, 1300000, 85, 'BuyBox', fill=CARD,
           paragraphs=[
               P(T('≥ 1.5%', FT, 28, GREEN), align='c', lnspc='85000'),
               P(T('→  標記為  Buy', FT, 12, GREEN), align='c'),
               P(T('隔天漲超過 1.5%，值得買', FB, 8.5, BODY_C), align='c'),
           ], anchor='ctr'),
        sp(5100000, 2450000, 3600000, 1300000, 86, 'NotBuyBox', fill=CARD,
           paragraphs=[
               P(T('< 1.5%', FT, 28, BODY_C), align='c', lnspc='85000'),
               P(T('→  標記為  NotBuy', FT, 12, BODY_C), align='c'),
               P(T('漲幅不夠，或下跌', FB, 8.5, BODY_C), align='c'),
           ], anchor='ctr'),

        # Note
        sp(LM, 3900000, RM-LM, 900000, 87, 'Note', fill=CARD_M,
           paragraphs=[
               P(T('為什麼選 1.5%？', FT, 9, TITLE_C)),
               P(T('1.5% 是一個合理的最低獲利空間——扣掉買賣手續費後仍有正報酬。', FB, 9, BODY_C)),
               P(T('太低（如 0.5%）會讓幾乎所有天都是 Buy，標籤失去意義；', FB, 8.5, DIM)),
               P(T('太高（如 3%）會讓 Buy 樣本太少，模型難以學習。', FB, 8.5, DIM)),
           ], inset=50000),
    ])


def s09_train(slide):
    """模型怎麼訓練"""
    header(slide, '模型是怎麼訓練的？', 'TRAINING PIPELINE',
           '模型從每個交易日往前看 20 天的資料，學習「這種市場狀態下，明天值不值得買」。')

    steps = [
        ('①', '讀入 6 年資料', '16 檔股票的每日 OHLCV + 技術指標'),
        ('②', '計算 50 個特徵', '每個交易日以前 20 天的資料為視窗，計算動能、均線、MACD 等'),
        ('③', '標記標籤', '計算隔日報酬，≥ 1.5% → Buy，否則 → NotBuy'),
        ('④', 'XGBoost 訓練', '400 棵樹，深度 6，學習率 0.05，共約 22,000 筆樣本'),
        ('⑤', '儲存模型', '存成 .joblib 檔，API 啟動時讀取，即時預測'),
    ]

    for i, (num, title, desc) in enumerate(steps):
        iy = 1050000 + i * 730000
        add(slide, [
            sp(LM,       iy, 350000, 670000, 90+i*3, f'Num{i}',
               fill=ACCENT, prst='roundRect', adj=16667,
               paragraphs=[P(T(num, FT, 14, WHITE), align='c')], anchor='ctr'),
            sp(1000000, iy, 7650000, 670000, 91+i*3, f'Step{i}',
               fill=CARD,
               paragraphs=[
                   P(T(title, FT, 10.5, TITLE_C)),
                   P(T(desc,  FB,  9,   BODY_C)),
               ], anchor='ctr', inset=50000),
        ])

    add(slide, [
        sp(LM, 4700000, RM-LM, 230000, 120, 'Params', fill=CARD_M,
           paragraphs=[P(T(
               'XGBoost 超參數：n_estimators=400  ·  max_depth=6  ·  learning_rate=0.05  ·  '
               'subsample=0.9  ·  colsample_bytree=0.8',
               FB, 8, BODY_C), align='c')], anchor='ctr'),
    ])


def s10_timesplit(slide):
    """為什麼不能隨機切分"""
    header(slide, '為什麼不能隨機切分資料？', 'WHY NOT RANDOM SPLIT',
           '股票資料有時間順序——如果讓模型「偷看未來」的資料，測試分數會虛高，實際用時才發現根本不準。')

    add(slide, [
        # Wrong way
        sp(LM, 1050000, 3850000, 3500000, 130, 'Wrong', fill=CARD,
           paragraphs=[
               P(T('❌ 隨機切分（錯誤）', FT, 10.5, RED), spacing=0),
               P(T('', FB, 6, BODY_C)),
               P(T('把資料隨機打亂後切成訓練/測試', FB, 9, BODY_C)),
               P(T('', FB, 5, BODY_C)),
               P(T('問題：', FB, 9, WARN)),
               P(T('• 模型訓練時「看到了」2025 年的資料', FB, 9, BODY_C)),
               P(T('• 用 2023 年的資料去預測 2022 年 → 偷看未來', FB, 9, BODY_C)),
               P(T('• 這叫 Look-ahead Bias（未來資訊洩漏）', FB, 9, BODY_C)),
               P(T('• 測試分數看起來很好，但實際用不了', FB, 9, BODY_C)),
           ], inset=55000),

        # Right way
        sp(4950000, 1050000, 3750000, 3500000, 131, 'Right', fill=CARD,
           paragraphs=[
               P(T('✅ 時間順序切分（正確）', FT, 10.5, GREEN), spacing=0),
               P(T('', FB, 6, BODY_C)),
               P(T('訓練資料全部在測試資料「之前」', FB, 9, BODY_C)),
               P(T('', FB, 5, BODY_C)),
               P(T('我們的做法：', FB, 9, TITLE_C)),
               P(T('• 以日期為界，訓練 2020～2024，測試 2025', FB, 9, BODY_C)),
               P(T('• 模型完全不知道測試期發生了什麼', FB, 9, BODY_C)),
               P(T('• 這才是真實情況下的預測', FB, 9, BODY_C)),
               P(T('• 分數比較低但更誠實', FB, 9, BODY_C)),
           ], inset=55000),

        # Bottom note
        sp(LM, 4700000, RM-LM, 280000, 132, 'Note', fill=CARD_M,
           paragraphs=[P(T(
               '類比：你不能用「考試題目」來練習，然後再說自己考試很強。\n'
               '測試集必須是模型從來沒見過的資料。',
               FB, 9, BODY_C))]),
    ])


def s11_expanding(slide):
    """Expanding Window 驗證"""
    header(slide, '我們用「滾動擴展窗口」驗證模型', 'EXPANDING WINDOW CROSS-VALIDATION',
           '光一次時間切分還不夠嚴格——不同年份的市場環境差很多。我們用 10 年資料池做了 5 次擴展式測試。')

    LX, RX = LM, 8900000
    W = RX - LX
    START_YR, END_YR = 2017, 2026
    PY = W / (END_YR - START_YR + 1)        # pixels per year (2017–2026 = 10 years)
    ROW_H, GAP = 420000, 60000
    Y0 = 1050000

    FOLDS = [
        ('Fold 1', 2017, 2022, '2022 年測試'),
        ('Fold 2', 2017, 2023, '2023 年測試'),
        ('Fold 3', 2017, 2024, '2024 年測試'),
        ('Fold 4', 2017, 2025, '2025 年測試'),
        ('Fold 5', 2017, 2026, '2026 年（進行中）'),
    ]

    els = []
    sid = 140

    # Year labels
    for yr in range(START_YR, END_YR + 1):
        lx = int(LX + (yr - START_YR) * PY)
        els.append(sp(lx, Y0 - 110000, int(PY), 100000, sid, f'YL{yr}',
                      no_fill=True, inset=0,
                      paragraphs=[P(T(str(yr), FB, 7.5, BODY_C), align='c')]))
        sid += 1

    for fi, (fold, ts, te, test_label) in enumerate(FOLDS):
        fy = Y0 + fi * (ROW_H + GAP)
        train_cx = int((te - ts) * PY)
        test_cx  = int(PY)
        tx = int(LX + (te - START_YR) * PY)
        test_col = WARN if te == END_YR else ACCENT

        els.append(sp(LX, fy, train_cx, ROW_H, sid, f'Train{fi}',
                      fill=CARD_M,
                      paragraphs=[P(T(f'TRAIN  {ts}–{te-1}', FT, 8, TITLE_C), align='c')],
                      anchor='ctr'))
        sid += 1
        els.append(sp(tx, fy, test_cx, ROW_H, sid, f'Test{fi}',
                      fill=test_col,
                      paragraphs=[P(T(test_label, FT, 7.5, BODY_C), align='c')],
                      anchor='ctr'))
        sid += 1

    # Legend
    ly = Y0 + 5*(ROW_H+GAP) + 40000
    els += [
        sp(LM,         ly, 220000, 100000, sid,   'LT', fill=CARD_M),
        sp(LM+270000,  ly, 220000, 100000, sid+1, 'LTS', fill=ACCENT),
        sp(LM+30000,   ly+15000, 190000, 70000, sid+2, 'LTTxt',
           no_fill=True, inset=0, paragraphs=[P(T('訓練', FB, 7, TITLE_C), align='c')]),
        sp(LM+300000,  ly+15000, 190000, 70000, sid+3, 'LTSTxt',
           no_fill=True, inset=0, paragraphs=[P(T('測試', FB, 7, BODY_C), align='c')]),
        sp(RM-1750000, ly+15000, 1650000, 70000, sid+4, 'LYNote',
           no_fill=True, inset=0,
           paragraphs=[P(T('10 年資料池：2017–2026', FB, 7, ACCENT), align='r')]),
    ]
    add(slide, els)


def s12_results(slide):
    """整體訓練結果"""
    header(slide, '整體訓練結果', 'MODEL PERFORMANCE',
           '以 2024 年底為切點，訓練 2019–2024，測試 2025 年以後，共約 22,000 筆訓練樣本。')

    stats = [
        ('64.2%', '整體準確率',      '猜對方向的比例', GREEN),
        ('60.9%', 'Buy 精確率',     '說「買」時，隔天真的漲 ≥1.5% 的比例', TITLE_C),
        ('56.4%', 'Macro F1',      '同時考慮 Buy 和 NotBuy 的綜合分數', BODY_C),
    ]

    for i, (val, lbl, sub, col) in enumerate(stats):
        bx = LM + i * 2750000
        add(slide, [
            sp(bx, 1050000, 2600000, 1500000, 160+i*3, f'Stat{i}', fill=CARD,
               paragraphs=[
                   P(T(val, FT, 30, col), align='c', lnspc='85000'),
                   P(T(lbl, FT, 10, TITLE_C), align='c'),
                   P(T(sub, FB,  7.5, BODY_C), align='c'),
               ], anchor='ctr'),
        ])

    # Comparison table vs RF
    add(slide, [
        sp(LM, 2700000, RM-LM, 200000, 170, 'CompTitle', no_fill=True, inset=0,
           paragraphs=[P(T('與隨機森林的比較', FT, 10, TITLE_C))]),
    ])

    rows = [
        ('指標',       'Random Forest', 'XGBoost', '提升幅度'),
        ('準確率',     '51.4%',         '64.2%',   '+12.8%'),
        ('Macro F1',  '49.4%',         '56.4%',   '+7.0%'),
        ('Buy 精確率', '42.5%',         '60.9%',   '+18.4%'),
    ]
    cols_w = [2200000, 2000000, 2000000, 1800000]
    cols_x = [LM]
    for w in cols_w[:-1]:
        cols_x.append(cols_x[-1] + w + 15000)

    for ri, row in enumerate(rows):
        ry = 2960000 + ri * 490000
        bg = CARD_M if ri == 0 else (CARD if ri%2==1 else "261629")
        add(slide, [sp(LM, ry, sum(cols_w)+45000, 450000, 171+ri, f'RBg{ri}', fill=bg)])
        for ci, (val, cx, cw) in enumerate(zip(row, cols_x, cols_w)):
            col = TITLE_C if ri == 0 else (GREEN if ci in (2,3) and ri > 0 else BODY_C)
            add(slide, [
                sp(cx+15000, ry, cw-30000, 450000, 172+ri*10+ci, f'RC{ri}_{ci}',
                   no_fill=True, inset=15000,
                   paragraphs=[P(T(val, FT if ri==0 else FB, 9, col), align='c')],
                   anchor='ctr'),
            ])


def s13_generalization(slide):
    """放到沒看過的股票準嗎"""
    header(slide, '放到「沒看過」的股票上，還準嗎？', 'CROSS-STOCK GENERALIZATION',
           '訓練時完全排除測試股票——模型從未見過這檔股票的任何一天資料，驗證期為 2025 年以後。')

    rows = [
        ('ALAB', 'AI 晶片',   '66.5%', '74.4%', '+2.95%', '121', GREEN,   '✅ 良好'),
        ('AMD',  '半導體',    '70.2%', '87.7%', '+3.15%', '73',  GREEN,   '✅ 優異'),
        ('META', '社群科技',  '76.6%', '82.6%', '+2.10%', '46',  GREEN,   '✅ 良好'),
        ('INTC', '半導體',    '68.8%', '73.3%', '+2.97%', '86',  TITLE_C, '✅ 良好'),
        ('O',    'REIT',     '79.8%', '47.8%', '+0.07%', '23',  RED,     '⚠️ 不佳'),
    ]
    hdrs = ('股票', '產業', '準確率', 'Buy 勝率', '平均報酬', '訊號數', '評估')
    col_widths = [700000, 1100000, 800000, 800000, 1000000, 700000, 1050000]
    col_xs = [LM]
    for w in col_widths[:-1]:
        col_xs.append(col_xs[-1] + w + 10000)

    add(slide, [sp(LM, 1050000, sum(col_widths)+60000, 380000, 180, 'HdrBg', fill=CARD_M)])
    for ci, (h, cx, cw) in enumerate(zip(hdrs, col_xs, col_widths)):
        add(slide, [
            sp(cx+15000, 1050000, cw-30000, 380000, 181+ci, f'H{ci}',
               no_fill=True, inset=10000,
               paragraphs=[P(T(h, FT, 8.5, TITLE_C), align='c')], anchor='ctr'),
        ])

    for ri, (sym, sec, acc, win, ret, sigs, win_col, verdict) in enumerate(rows):
        ry = 1480000 + ri * 490000
        bg = CARD if ri%2==0 else "261629"
        is_bad = sym == 'O'
        add(slide, [sp(LM, ry, sum(col_widths)+60000, 450000, 190+ri, f'RBg{ri}', fill=bg)])
        vals = (sym, sec, acc, win, ret, sigs, verdict)
        for ci, (v, cx, cw) in enumerate(zip(vals, col_xs, col_widths)):
            col = BODY_C
            if ci == 0:   col = TITLE_C
            if ci == 3:   col = win_col
            if ci == 4:   col = GREEN if not is_bad else RED
            if ci == 6:   col = RED if is_bad else GREEN
            add(slide, [
                sp(cx+15000, ry, cw-30000, 450000, 191+ri*10+ci, f'C{ri}_{ci}',
                   no_fill=True, inset=10000,
                   paragraphs=[P(T(v, FT if ci==0 else FB, 8.5 if ci==0 else 8, col), align='c')],
                   anchor='ctr'),
            ])

    add(slide, [
        sp(LM, 3970000, RM-LM, 900000, 250, 'ONote', fill=CARD,
           paragraphs=[
               P(T('為什麼 O (REIT) 不準？', FT, 9.5, WARN)),
               P(T('O 是房地產信託，它的漲跌跟利率和租金收入有關，和科技股的邏輯完全不同。', FB, 9, BODY_C)),
               P(T('我們的模型學的是科技/半導體股的市場規律，所以對 REIT 的泛化能力很差。', FB, 9, BODY_C)),
               P(T('這也說明：模型只適合用在「同類型」的股票上。', FB, 9, DIM)),
           ], inset=55000),
    ])


def s14_persymbol(slide):
    """每檔股票 Buy 訊號表現"""
    header(slide, '每檔股票的 Buy 訊號表現', 'PER-SYMBOL BUY SIGNALS',
           '當模型發出 Buy 訊號時，隔天實際的表現如何？以下是 2025 年以後的回測結果。')

    symbols = [
        ('AMD',  '半導體', '87.7%', '+3.15%', '73',  GREEN, GREEN),
        ('META', '科技',   '82.6%', '+2.10%', '46',  GREEN, GREEN),
        ('INTC', '半導體', '73.3%', '+2.97%', '86',  TITLE_C, GREEN),
        ('ALAB', 'AI晶片', '74.4%', '+2.95%', '121', TITLE_C, GREEN),
        ('O',    'REIT',  '47.8%', '+0.07%', '23',  RED,    RED),
    ]

    CW, CH = 1660000, 3600000
    GAP = 90000
    Y0  = 1050000

    for i, (sym, sec, win, ret, sigs, wc, rc) in enumerate(symbols):
        bx = LM + i * (CW + GAP)
        is_bad = sym == 'O'
        add(slide, [
            sp(bx, Y0, CW, CH, 260+i*8, f'Card{i}',
               fill=CARD if not is_bad else "1A0C10"),
            sp(bx+60000, Y0+70000, CW-120000, 130000, 261+i*8, f'Sec{i}',
               fill=CARD_M if not is_bad else "3A1515",
               prst='roundRect', adj=16667,
               paragraphs=[P(T(sec, FB, 7.5, BODY_C), align='c')], anchor='ctr'),
            sp(bx, Y0+240000, CW, 280000, 262+i*8, f'Sym{i}',
               no_fill=True, inset=0,
               paragraphs=[P(T(sym, FT, 18, wc), align='c')]),
            sp(bx, Y0+560000, CW, 480000, 263+i*8, f'Win{i}',
               no_fill=True, inset=0,
               paragraphs=[
                   P(T(win, FT, 26, wc), align='c', lnspc='85000'),
                   P(T('Buy 勝率', FB, 7.5, BODY_C), align='c'),
               ]),
            sp(bx+80000, Y0+1090000, CW-160000, 30000, 264+i*8, f'Div{i}',
               fill=CARD_M),
            sp(bx, Y0+1170000, CW, 620000, 265+i*8, f'Ret{i}',
               no_fill=True, inset=40000,
               paragraphs=[
                   P(T('平均隔日報酬', FB, 7.5, BODY_C), align='c'),
                   P(T(ret, FT, 20, rc), align='c', lnspc='85000'),
               ]),
            sp(bx, Y0+1940000, CW, 550000, 266+i*8, f'Sig{i}',
               no_fill=True, inset=40000,
               paragraphs=[
                   P(T('訊號數（2025～）', FB, 7.5, BODY_C), align='c'),
                   P(T(sigs, FT, 20, TITLE_C), align='c', lnspc='85000'),
               ]),
            sp(bx+60000, Y0+2670000, CW-120000, 700000, 267+i*8, f'Vrd{i}',
               fill=CARD_M if not is_bad else "3A1515",
               prst='roundRect', adj=10000,
               paragraphs=[
                   P(T('泛化不佳（REIT）' if is_bad else '✅ 泛化良好',
                       FB, 8, RED if is_bad else GREEN), align='c'),
               ], anchor='ctr'),
        ])


def s15_noise_match(slide):
    """我們的做法對應老師講義"""
    header(slide, '對應老師的講義：雜訊處理', 'NOISE HANDLING ↔ TEACHER\'S LECTURE',
           '老師講義說：看到可疑資料，不代表一定要刪；要先判斷原因、有理由才移除。我們的三層清洗就是這樣設計的。')

    rows = [
        ('講義概念',                     '我們的實作'),
        ('雜訊 = 小幅不規則擾動',        '技術指標前 25 天值不穩定 → 跳過，不當成訓練資料'),
        ('資料錯誤 = 資料本身就是錯的',  'close ≤ 0 / RSI > 100 / 缺失值 → 移除'),
        ('確認是錯誤才刪除',             '只刪除確定有問題的列，不隨意刪「看起來奇怪」的資料'),
        ('使用穩健模型降低雜訊影響',     '使用 XGBoost（集成方法），對少數雜訊資料不敏感'),
        ('交叉驗證確認結果穩定',         '5 折擴展窗口驗證，每年測試一次，確保結果一致'),
    ]

    col_w = [3900000, 4700000]
    col_x = [LM, LM + col_w[0] + 20000]

    for ri, (left, right) in enumerate(rows):
        ry = 1050000 + ri * 600000
        bg = CARD_M if ri == 0 else (CARD if ri%2==1 else "261629")
        total_w = sum(col_w) + 20000
        add(slide, [sp(LM, ry, total_w, 560000, 300+ri, f'Rbg{ri}', fill=bg)])
        for ci, (val, cx, cw) in enumerate(zip((left, right), col_x, col_w)):
            col = TITLE_C if ri == 0 else (BODY_C if ci==0 else GREEN)
            add(slide, [
                sp(cx+15000, ry, cw-30000, 560000, 301+ri*10+ci, f'RC{ri}_{ci}',
                   no_fill=True, inset=15000,
                   paragraphs=[P(T(val, FT if ri==0 else FB, 9 if ri>0 else 8.5, col))],
                   anchor='ctr'),
            ])


def s16_limitations(slide):
    """模型的限制"""
    header(slide, '模型有哪些限制？', 'LIMITATIONS',
           '準確率 64.2%、Buy 勝率最高 87.7%，聽起來不錯——但要誠實說出模型的局限。')

    items = [
        (RED,    '只預測隔日，不是持倉策略',
                 '模型說「Buy」只代表「今天買明天賣可能有賺」，不是長期持有建議。'),
        (RED,    '不考慮手續費、滑點、流動性',
                 '實際交易有成本，少量盈利可能被吃掉。回測數字是理想情況。'),
        (WARN,   '對特定股票不適用（如 REIT）',
                 '模型學的是科技/半導體邏輯，放到完全不同產業的股票上效果很差。'),
        (WARN,   '市場環境可能改變（概念漂移）',
                 '訓練資料包含 2019-2024 的市場，若未來市場結構改變，模型需要重新訓練。'),
        (DIM,    '樣本量偏少（外部驗證）',
                 '2025 年以後的資料只有幾個月，73～121 筆訊號，統計上仍需觀察更長時間。'),
        (DIM,    '特徵僅限技術面',
                 '沒有考慮財報、新聞情緒、總體經濟等基本面因素。'),
    ]

    for i, (col, title, desc) in enumerate(items):
        bx = LM + (i % 2) * 4100000
        by = 1050000 + (i // 2) * 1350000
        add(slide, [
            sp(bx, by, 3900000, 1250000, 340+i*2, f'Lim{i}', fill=CARD,
               paragraphs=[
                   P(T(title, FT, 10, col)),
                   P(T('', FB, 5, BODY_C)),
                   P(T(desc, FB, 8.5, BODY_C)),
               ], inset=55000),
        ])


def s17_api(slide):
    """API 架構"""
    header(slide, '模型部署：FastAPI 即時預測', 'DEPLOYMENT',
           '訓練好的模型存成 .joblib 檔，透過 FastAPI 提供即時預測 API，每次傳入股票代號即可取得建議。')

    steps = [
        ('輸入',  '股票代號（如 AMD）', ACCENT),
        ('取得',  '從資料庫讀取最新 20 天歷史資料', CARD_M),
        ('計算',  '即時計算 50 個技術面特徵', CARD_M),
        ('推論',  'XGBoost 模型預測：Buy / NotBuy', CARD_M),
        ('輸出',  '回傳買進建議 + 預測機率 + AI 分析', ACCENT),
    ]

    for i, (label, desc, col) in enumerate(steps):
        bx = LM + i * 1680000
        add(slide, [
            sp(bx, 1050000, 1550000, 1700000, 360+i*3, f'Box{i}',
               fill=col,
               paragraphs=[
                   P(T(label, FT, 12, TITLE_C), align='c'),
                   P(T('', FB, 6, BODY_C), align='c'),
                   P(T(desc, FB, 8.5, BODY_C), align='c'),
               ], anchor='ctr'),
        ])
        if i < 4:
            ax = bx + 1570000
            add(slide, [
                sp(ax, 1650000, 90000, 500000, 361+i*3, f'Arr{i}',
                   no_fill=True, inset=0,
                   paragraphs=[P(T('→', FT, 16, ACCENT), align='c')]),
            ])

    add(slide, [
        sp(LM, 2900000, RM-LM, 1900000, 380, 'ApiNote', fill=CARD,
           paragraphs=[
               P(T('API 端點（FastAPI）', FT, 10, TITLE_C)),
               P(T('', FB, 5, BODY_C)),
               P(T('GET  /watchlist-predictions     →  取得所有追蹤股票的今日預測', FB, 9, BODY_C)),
               P(T('GET  /stock/{symbol}            →  取得單一股票的詳細分析', FB, 9, BODY_C)),
               P(T('GET  /ai-logs                   →  查看 AI 分析紀錄', FB, 9, BODY_C)),
               P(T('', FB, 5, BODY_C)),
               P(T('每次預測結果存入 SQLite 資料庫（predictions.db），方便追蹤歷史表現。', FB, 8.5, DIM)),
           ], inset=55000),
    ])


def s18_flow(slide):
    """整體流程回顧"""
    header(slide, '整體流程回顧', 'FULL PIPELINE RECAP',
           '從拿到原始股票資料，到輸出「Buy / NotBuy」建議——共經過以下步驟。')

    stages = [
        ('資料層', CARD_M, [
            '從 Yahoo Finance 下載 6 年資料',
            '16 檔股票 + 市場指標',
            '三層雜訊過濾',
            '日期對齊、缺失值檢查',
        ]),
        ('特徵層', CARD, [
            '計算 RSI、MFI、MACD、OBV、MA',
            '計算動能、波動、均線偏離',
            '加入市場環境特徵',
            '共 50 個特徵，20 日視窗',
        ]),
        ('模型層', CARD_M, [
            '標記 Buy / NotBuy（1.5% 門檻）',
            'XGBoost 訓練 400 棵樹',
            '存成 .joblib 供 API 使用',
            '取代舊的隨機森林模型',
        ]),
        ('驗證層', CARD, [
            '5 折擴展窗口交叉驗證',
            '跨股票泛化測試（5 檔）',
            '準確率 64.2%、Buy 精確率 60.9%',
            'AMD Buy 勝率 87.7%',
        ]),
    ]

    for i, (title, bg, bullets) in enumerate(stages):
        bx = LM + (i % 2) * 4100000
        by = 1050000 + (i // 2) * 1950000
        paras = [P(T(title, FT, 12, TITLE_C)), P(T('', FB, 5, BODY_C))]
        for b in bullets:
            paras.append(P(T(f'• {b}', FB, 9, BODY_C)))
        add(slide, [
            sp(bx, by, 3900000, 1800000, 390+i*2, f'Stage{i}', fill=bg,
               paragraphs=paras, inset=55000),
        ])


def s19_compare(slide):
    """對應課程概念"""
    header(slide, '對應課程學習內容', 'COURSE CONCEPTS APPLIED',
           '這份專題用到了課堂上學過的哪些 ML 概念？')

    concepts = [
        ('分類問題', TITLE_C,
         '把「隔日漲跌 ≥ 1.5%」定義成二分類任務，對應課堂的 Classification。'),
        ('模型評估指標', TITLE_C,
         '使用 Accuracy、Precision、Recall、F1-score、Confusion Matrix 評估模型，對應 ML_regression.pdf 的第二部分。'),
        ('集成學習', GREEN,
         'XGBoost 是 Boosting 集成方法，比單棵決策樹更穩健，對應課堂的 Decision Tree 延伸概念。'),
        ('過度擬合防範', WARN,
         '限制樹的 max_depth=6、使用 subsample=0.9，防止模型把訓練資料的雜訊都背起來。'),
        ('雜訊與異常值處理', GREEN,
         '對應 ml_noise.pdf：確認是錯誤才刪除；使用集成模型讓雜訊影響降低；交叉驗證確認穩定。'),
        ('時間序列驗證', WARN,
         '5 折擴展窗口，防止 Look-ahead Bias，比一般隨機切分更嚴格。'),
    ]

    for i, (title, col, desc) in enumerate(concepts):
        bx = LM + (i % 2) * 4100000
        by = 1050000 + (i // 2) * 1300000
        add(slide, [
            sp(bx, by, 3900000, 1200000, 410+i*2, f'C{i}', fill=CARD,
               paragraphs=[
                   P(T(title, FT, 10, col)),
                   P(T('', FB, 5, BODY_C)),
                   P(T(desc, FB, 8.5, BODY_C)),
               ], inset=55000),
        ])


def s20_conclusion(slide):
    """結論"""
    header(slide, '結論', 'CONCLUSION',
           '這份專題不是在說「模型能準確預測股價」，而是建立一套可追蹤、可驗證、可解釋的預測流程。')

    points = [
        (GREEN, '我們做到了',  [
            'XGBoost 準確率 64.2%，比隨機森林高 12.8%',
            'AMD Buy 訊號勝率 87.7%，平均報酬 +3.15%',
            '完整的三層資料清洗流程',
            '5 折擴展窗口，嚴格防止未來資訊洩漏',
        ]),
        (WARN, '還需要改進', [
            '只用技術面，沒有基本面資料',
            'O（REIT）等非科技類股效果差',
            '外部驗證樣本仍偏少（2025 年至今）',
            '還沒有考慮實際交易成本',
        ]),
        (TITLE_C, '下一步方向', [
            '加入財報資料和新聞情緒分析',
            '擴展至更多產業類別',
            '加入持倉期間最佳化策略',
            '自動定期重新訓練（防止概念漂移）',
        ]),
    ]

    for i, (col, title, bullets) in enumerate(points):
        bx = LM + i * 2730000
        paras = [P(T(title, FT, 10.5, col)), P(T('', FB, 5, BODY_C))]
        for b in bullets:
            paras.append(P(T(f'• {b}', FB, 8.5, BODY_C)))
        add(slide, [
            sp(bx, 1050000, 2580000, 3750000, 430+i*2, f'Pt{i}', fill=CARD,
               paragraphs=paras, inset=55000),
        ])

    add(slide, [
        sp(LM, 4950000, RM-LM, 100000, 440, 'Footer', fill=CARD_M,
           paragraphs=[P(T(
               '股價預測系統  ·  XGBoost 分類模型  ·  軟創三 賴思翰 / 軟創二 李良薇 / 軟創三 林佳誼',
               FB, 7, DIM), align='c')], anchor='ctr'),
    ])


# ── Slide deletion helper ─────────────────────────────────────────────────────
def delete_slide(prs, index):
    """Remove slide at index from presentation (XML manipulation)."""
    r_ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    xml_slides = prs.slides._sldIdLst
    slide_elem = xml_slides[index]
    rId = slide_elem.get(f'{{{r_ns}}}id')
    xml_slides.remove(slide_elem)
    try:
        prs.part.drop_rel(rId)
    except Exception:
        pass


# ── Main ──────────────────────────────────────────────────────────────────────
SLIDE_FUNCS = [
    s01_title, s02_problem, s03_data, s04_noise, s05_indicators,
    s06_features, s07_rf_vs_xgb, s08_label, s09_train, s10_timesplit,
    s11_expanding, s12_results, s13_generalization, s14_persymbol,
    s15_noise_match, s16_limitations, s17_api, s18_flow,
    s19_compare, s20_conclusion,
]

def main():
    prs = Presentation(PPTX_IN)
    original_count = len(prs.slides)
    print(f"Original slides: {original_count}")

    # Add 20 blank slides (inheriting master background)
    blank = prs.slide_layouts[6]
    new_slides = []
    for fn in SLIDE_FUNCS:
        slide = prs.slides.add_slide(blank)
        new_slides.append((fn, slide))
    print(f"Added {len(new_slides)} new slides")

    # Fill new slides with content
    for fn, slide in new_slides:
        fn(slide)
        print(f"  ✓ {fn.__name__}")

    # Delete original slides (in reverse to preserve indices)
    print(f"Removing {original_count} original slides...")
    for i in range(original_count - 1, -1, -1):
        delete_slide(prs, i)

    print(f"Final slide count: {len(prs.slides)}")
    prs.save(PPTX_OUT)
    print(f"\nSaved → {PPTX_OUT}")


if __name__ == '__main__':
    main()
