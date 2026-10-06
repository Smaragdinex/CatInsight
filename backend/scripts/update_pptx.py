#!/usr/bin/env python3
"""Update 期末報告.pptx — fill empty slides 17/20/22/24 and update slide 14 metrics."""

from lxml import etree
from pptx import Presentation

PPTX_IN  = './reports/期末報告.pptx'
PPTX_OUT = './reports/期末報告_updated.pptx'

NSP = 'http://schemas.openxmlformats.org/presentationml/2006/main'
NSA = 'http://schemas.openxmlformats.org/drawingml/2006/main'

# ── Design tokens ─────────────────────────────────────────────────────────────
CARD    = "321A2C"   # dark card
CARD_M  = "6D4562"   # medium purple card
ACCENT  = "A95B95"   # badge fill
TITLE_C = "C6BFEE"   # main title text
BODY_C  = "DAD8E9"   # body text
GREEN_C = "6FCF97"   # positive highlight
RED_C   = "EB5757"   # negative highlight
WARN_C  = "F2C94C"   # warning / neutral

FT = "Prompt Medium"
FB = "Mukta Light"

# ── XML helpers ───────────────────────────────────────────────────────────────
def _xml(x, y, cx, cy, sid, name,
         fill=None, no_fill=False, prst='rect', adj=None,
         paragraphs=None, wrap='square', anchor='t', inset=45720):
    """Build a complete <p:sp> XML string and return parsed element."""
    if adj is not None:
        geom = f'<a:prstGeom prst="{prst}"><a:avLst><a:gd name="adj" fmla="val {adj}"/></a:avLst></a:prstGeom>'
    else:
        geom = f'<a:prstGeom prst="{prst}"><a:avLst/></a:prstGeom>'

    if no_fill:
        fill_xml = '<a:noFill/>'
    elif fill:
        fill_xml = f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>'
    else:
        fill_xml = '<a:noFill/>'

    def safe(t):
        return str(t).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

    para_xml = ''
    if paragraphs:
        for para in paragraphs:
            align  = para.get('align', 'l')
            spc    = para.get('spacing', None)
            spc_xml = f'<a:spcBef><a:spcPts val="{spc}"/></a:spcBef>' if spc else ''
            lnspc  = para.get('lnspc', None)
            lnspc_xml = f'<a:lnSpc><a:spcPct val="{lnspc}"/></a:lnSpc>' if lnspc else ''
            runs_xml = ''
            for r in para.get('runs', []):
                t    = safe(r.get('text', ''))
                font = r.get('font', FB)
                sz   = int(round(r.get('pt', 9) * 100))
                col  = r.get('color', BODY_C)
                b    = ' b="1"' if r.get('bold') else ''
                runs_xml += (
                    f'<a:r>'
                    f'<a:rPr lang="zh-TW" sz="{sz}" dirty="0"{b}>'
                    f'<a:solidFill><a:srgbClr val="{col}"/></a:solidFill>'
                    f'<a:latin typeface="{font}" pitchFamily="34" charset="0"/>'
                    f'<a:ea typeface="{font}" pitchFamily="34" charset="-122"/>'
                    f'<a:cs typeface="{font}" pitchFamily="34" charset="-120"/>'
                    f'</a:rPr><a:t>{t}</a:t></a:r>'
                )
            para_xml += (
                f'<a:p><a:pPr algn="{align}"><a:buNone/>{spc_xml}{lnspc_xml}</a:pPr>'
                f'{runs_xml}</a:p>'
            )
        txBody = (
            f'<p:txBody>'
            f'<a:bodyPr wrap="{wrap}" lIns="{inset}" tIns="{inset}" '
            f'rIns="{inset}" bIns="{inset}" rtlCol="0" anchor="{anchor}"/>'
            f'<a:lstStyle/>{para_xml}</p:txBody>'
        )
    else:
        txBody = ''

    xml_str = (
        f'<p:sp xmlns:p="{NSP}" xmlns:a="{NSA}">'
        f'<p:nvSpPr>'
        f'<p:cNvPr id="{sid}" name="{name}"/>'
        f'<p:cNvSpPr/><p:nvPr/>'
        f'</p:nvSpPr>'
        f'<p:spPr>'
        f'<a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        f'{geom}{fill_xml}<a:ln><a:noFill/></a:ln>'
        f'</p:spPr>'
        f'{txBody}'
        f'</p:sp>'
    )
    return etree.fromstring(xml_str)


def add_to(slide, elements):
    tree = slide.shapes._spTree
    for el in elements:
        tree.append(el)


def T(text, font=FB, pt=9, color=BODY_C, bold=False):
    """Shorthand for a run dict."""
    return {'text': text, 'font': font, 'pt': pt, 'color': color, 'bold': bold}


def P(*runs, align='l', spacing=None, lnspc=None):
    """Shorthand for a paragraph dict."""
    return {'runs': list(runs), 'align': align, 'spacing': spacing, 'lnspc': lnspc}


def title_group(slide, title_text, badge_text, desc_text, sid_start=100):
    """Add the standard title + badge + description header used across slides."""
    shapes = [
        # Title
        _xml(550664, 220000, 8000000, 360000, sid_start, 'TitleText',
             no_fill=True,
             paragraphs=[P(T(title_text, FT, 20.5, TITLE_C))]),
        # Badge (rounded rect)
        _xml(550664, 640000, 900000, 148000, sid_start+1, 'Badge',
             fill=ACCENT, prst='roundRect', adj=16667),
        # Badge text
        _xml(550664, 646000, 900000, 136000, sid_start+2, 'BadgeText',
             no_fill=True, inset=0,
             paragraphs=[P(T(badge_text, FB, 6.8, BODY_C), align='c')]),
        # Description
        _xml(550664, 820000, 8000000, 200000, sid_start+3, 'Desc',
             no_fill=True,
             paragraphs=[P(T(desc_text, FB, 9, BODY_C))]),
    ]
    add_to(slide, shapes)


# ══════════════════════════════════════════════════════════════════════════════
# SLIDE 14  ─  add actual performance numbers below comparison table
# ══════════════════════════════════════════════════════════════════════════════
def update_slide14(slide):
    y0 = 4510000
    h  = 500000

    els = [
        # Background strip
        _xml(550664, y0, 8042672, h, 200, 'MetricsBg', fill=CARD),

        # Label
        _xml(550664, y0 + 20000, 8042672, 130000, 201, 'MetricsLabel',
             no_fill=True, inset=0,
             paragraphs=[P(T('實際二分類測試結果 (Binary, Threshold 1.5%)', FB, 7.5, ACCENT), align='c')]),

        # Metric 1: Accuracy
        _xml(570000, y0 + 165000, 2450000, 280000, 202, 'M1',
             fill=CARD_M,
             paragraphs=[
                 P(T('準確率 (Accuracy)', FB, 7.5, BODY_C), align='c'),
                 P(T('RF  51.4%', FB, 9.5, BODY_C), T('   →   ', FB, 9.5, BODY_C),
                   T('XGB  64.2%', FT, 10.5, TITLE_C, bold=True), align='c'),
             ], anchor='ctr'),

        # Metric 2: F1
        _xml(3170000, y0 + 165000, 2450000, 280000, 203, 'M2',
             fill=CARD_M,
             paragraphs=[
                 P(T('Macro F1 分數', FB, 7.5, BODY_C), align='c'),
                 P(T('RF  49.4%', FB, 9.5, BODY_C), T('   →   ', FB, 9.5, BODY_C),
                   T('XGB  56.4%', FT, 10.5, TITLE_C, bold=True), align='c'),
             ], anchor='ctr'),

        # Metric 3: Buy precision
        _xml(5770000, y0 + 165000, 2820000, 280000, 204, 'M3',
             fill=CARD_M,
             paragraphs=[
                 P(T('Buy 精確率 (Precision)', FB, 7.5, BODY_C), align='c'),
                 P(T('RF  42.5%', FB, 9.5, BODY_C), T('   →   ', FB, 9.5, BODY_C),
                   T('XGB  60.9%', FT, 10.5, TITLE_C, bold=True), align='c'),
             ], anchor='ctr'),
    ]
    add_to(slide, els)


# ══════════════════════════════════════════════════════════════════════════════
# SLIDE 17  ─  XGBoost 模型超參數 & 訓練結果
# ══════════════════════════════════════════════════════════════════════════════
def fill_slide17(slide):
    title_group(slide,
                'XGBoost 模型超參數與訓練結果',
                'MODEL PARAMETERS & RESULTS',
                '使用 50 個技術面與市場背景特徵，訓練 400 棵決策樹，從 20 日市場脈絡學習隔日操作方向。',
                sid_start=100)

    # ── Left card: hyperparameters ─────────────────────────────────────────
    params = [
        ('n_estimators',   '400 棵樹'),
        ('max_depth',       '6'),
        ('learning_rate',   '0.05'),
        ('subsample',       '0.9'),
        ('colsample_bytree','0.8'),
        ('objective',       'binary:logistic'),
        ('特徵數量',         '50 個'),
        ('訓練樣本數',        '~22,000 筆'),
    ]
    param_paras = [
        P(T('超參數設定', FT, 10, TITLE_C), spacing=0),
        P(T('', FB, 4, BODY_C)),  # spacer
    ]
    for k, v in params:
        param_paras.append(
            P(T(f'• {k}', FB, 8.5, BODY_C), T(f'  =  {v}', FT, 8.5, TITLE_C))
        )

    els = [
        _xml(550664, 1070000, 3800000, 3700000, 110, 'ParamCard',
             fill=CARD,
             paragraphs=param_paras, anchor='t', inset=60000),
    ]

    # ── Right area: 3 stat boxes ───────────────────────────────────────────
    stats = [
        ('64.2%',  '整體準確率',    '3-Class Accuracy', GREEN_C),
        ('56.4%',  'Macro F1',      'F1 分數（宏觀平均）', TITLE_C),
        ('60.9%',  'Buy 精確率',    'Precision for Buy signal', GREEN_C),
    ]
    box_w, box_h = 3700000, 970000
    bx = 4800000
    for i, (val, label, sub, col) in enumerate(stats):
        by = 1070000 + i * (box_h + 80000)
        els += [
            _xml(bx, by, box_w, box_h, 120+i*3, f'StatBox{i}',
                 fill=CARD,
                 paragraphs=[
                     P(T(val, FT, 28, col), align='c', lnspc='90000'),
                     P(T(label, FT, 11, TITLE_C), align='c'),
                     P(T(sub,  FB,  7.5, BODY_C), align='c'),
                 ], anchor='ctr'),
        ]

    add_to(slide, els)


# ══════════════════════════════════════════════════════════════════════════════
# SLIDE 20  ─  Expanding Window 時間序列交叉驗證圖示
# ══════════════════════════════════════════════════════════════════════════════
def fill_slide20(slide):
    title_group(slide,
                '滾動擴展窗口交叉驗證',
                'EXPANDING WINDOW CROSS-VALIDATION',
                '我們用 10 年資料池做 5 次擴展式驗證；每一折的訓練資料往後延伸一年，測試資料永遠在訓練資料之後。',
                sid_start=200)

    # Year scale: 2017 → 2026  (10 years total)
    # Available width: from x=550664 to x=8900000
    LX   = 550664
    RX   = 8950000
    W    = RX - LX        # 8399336
    START_YR, END_YR = 2017, 2026
    PY   = W / (END_YR - START_YR + 1)          # pixels per year

    ROW_H   = 440000
    ROW_GAP = 80000
    Y0      = 1080000

    FOLDS = [
        ('Fold 1', 2017, 2022, 2022, 2023),
        ('Fold 2', 2017, 2023, 2023, 2024),
        ('Fold 3', 2017, 2024, 2024, 2025),
        ('Fold 4', 2017, 2025, 2025, 2026),
        ('Fold 5', 2017, 2026, 2026, 2027),
    ]

    els = []
    sid = 210

    # Year labels on top
    for yr in range(START_YR, END_YR + 1):
        lx = int(LX + (yr - START_YR) * PY)
        els.append(_xml(lx, Y0 - 120000, int(PY), 110000, sid, f'YrLabel{yr}',
                        no_fill=True, inset=0,
                        paragraphs=[P(T(str(yr), FB, 7.5, BODY_C), align='c')]))
        sid += 1

    for fi, (fold_name, train_start, train_end, test_start, test_end) in enumerate(FOLDS):
        fy = Y0 + fi * (ROW_H + ROW_GAP)

        train_x  = int(LX + (train_start - START_YR) * PY)
        train_cx = int((train_end - train_start) * PY)
        test_x   = int(LX + (test_start - START_YR) * PY)
        test_cx  = int((test_end - test_start) * PY)

        test_end_yr = min(test_end, END_YR)

        # Train bar
        els.append(_xml(train_x, fy, train_cx, ROW_H, sid, f'Train{fi}',
                        fill=CARD_M,
                        paragraphs=[
                            P(T(f'TRAIN  {train_start}–{train_end-1}', FT, 8, TITLE_C), align='c')
                        ], anchor='ctr'))
        sid += 1

        # Test bar
        test_label = f'TEST  {test_start}' if test_end <= END_YR else f'TEST  {test_start} (進行中)'
        test_col   = GREEN_C if test_end <= END_YR else WARN_C
        els.append(_xml(test_x, fy, test_cx, ROW_H, sid, f'Test{fi}',
                        fill=ACCENT,
                        paragraphs=[
                            P(T(test_label, FT, 8, BODY_C), align='c')
                        ], anchor='ctr'))
        sid += 1

    # Legend
    legend_y = Y0 + 5 * (ROW_H + ROW_GAP) + 40000
    els += [
        _xml(LX, legend_y, 260000, 100000, sid,   'LegTrain', fill=CARD_M),
        _xml(LX + 300000, legend_y, 260000, 100000, sid+1, 'LegTest', fill=ACCENT),
        _xml(LX + 30000, legend_y + 15000, 240000, 80000, sid+2, 'LegTrainTxt',
             no_fill=True, inset=0,
             paragraphs=[P(T('訓練集', FB, 7, TITLE_C), align='c')]),
        _xml(LX + 330000, legend_y + 15000, 240000, 80000, sid+3, 'LegTestTxt',
             no_fill=True, inset=0,
             paragraphs=[P(T('測試集', FB, 7, BODY_C), align='c')]),
        _xml(RX - 1750000, legend_y + 15000, 1650000, 80000, sid+4, 'LegNote',
             no_fill=True, inset=0,
             paragraphs=[P(T('10 年資料池：2017–2026', FB, 7, ACCENT), align='r')]),
    ]

    add_to(slide, els)


# ══════════════════════════════════════════════════════════════════════════════
# SLIDE 22  ─  跨股票泛化驗證結果表
# ══════════════════════════════════════════════════════════════════════════════
def fill_slide22(slide):
    title_group(slide,
                '跨股票泛化驗證結果',
                'CROSS-STOCK GENERALIZATION',
                '訓練時完全排除測試股票，模型從未見過該股票的任何資料，驗證期為 2025 年以後。',
                sid_start=300)

    # Data
    rows = [
        ('ALAB', 'AI 基礎設施晶片', '66.5%', '74.4%', '+2.95%', '121', '✅ 良好'),
        ('AMD',  '半導體龍頭',       '70.2%', '87.7%', '+3.15%', '73',  '✅ 優異'),
        ('META', '社群媒體科技',     '76.6%', '82.6%', '+2.10%', '46',  '✅ 良好'),
        ('INTC', '傳統半導體',       '68.8%', '73.3%', '+2.97%', '86',  '✅ 良好'),
        ('O',    '房地產 REIT',     '79.8%', '47.8%', '+0.07%', '23',  '⚠️ 不佳'),
    ]

    COLS = [
        ('股票',         700000),
        ('產業',         1200000),
        ('準確率',       800000),
        ('Buy 勝率',     800000),
        ('平均隔日報酬', 1000000),
        ('訊號數',       700000),
        ('泛化評估',     900000),
    ]

    LX   = 550664
    TY   = 1100000
    ROW_H = 450000
    HEADER_H = 360000

    # Build column x positions
    col_xs = []
    cx = LX
    for _, w in COLS:
        col_xs.append(cx)
        cx += w

    els = []
    sid = 310

    # Header row
    els.append(_xml(LX, TY, cx - LX, HEADER_H, sid, 'HeaderBg', fill=CARD_M))
    sid += 1
    for (hdr, w), hx in zip(COLS, col_xs):
        els.append(_xml(hx + 20000, TY, w - 40000, HEADER_H, sid, f'Hdr_{hdr}',
                        no_fill=True, inset=20000,
                        paragraphs=[P(T(hdr, FT, 8.5, TITLE_C), align='c')],
                        anchor='ctr'))
        sid += 1

    # Data rows
    for ri, row in enumerate(rows):
        ry = TY + HEADER_H + ri * (ROW_H + 12000)
        bg_fill = CARD if ri % 2 == 0 else "261629"
        is_bad = row[0] == 'O'

        els.append(_xml(LX, ry, cx - LX, ROW_H, sid, f'RowBg{ri}', fill=bg_fill))
        sid += 1

        for ci, ((_, w), hx, val) in enumerate(zip(COLS, col_xs, row)):
            col_color = BODY_C
            if ci == 3:   # Buy 勝率
                v = float(val.replace('%','').replace('+',''))
                col_color = GREEN_C if v >= 75 else (WARN_C if v >= 60 else RED_C)
            elif ci == 4:  # 平均報酬
                col_color = GREEN_C if val.startswith('+') and float(val[1:-1]) > 0.5 else RED_C
            elif ci == 6:  # 評估
                col_color = RED_C if is_bad else GREEN_C

            els.append(_xml(hx + 20000, ry, w - 40000, ROW_H, sid, f'Cell{ri}_{ci}',
                            no_fill=True, inset=20000,
                            paragraphs=[P(T(val, FT if ci == 0 else FB, 8.5 if ci == 0 else 8, col_color),
                                          align='c')],
                            anchor='ctr'))
            sid += 1

    # Note
    note_y = TY + HEADER_H + 5 * (ROW_H + 12000) + 30000
    els.append(_xml(LX, note_y, cx - LX, 200000, sid, 'Note',
                    no_fill=True, inset=0,
                    paragraphs=[P(T(
                        '* O (REIT) 勝率偏低，說明模型學習的是科技/半導體股票的市場模式，對 REIT 類別泛化能力有限。',
                        FB, 7.5, ACCENT))]))

    add_to(slide, els)


# ══════════════════════════════════════════════════════════════════════════════
# SLIDE 24  ─  個股 Buy 訊號回測詳細結果
# ══════════════════════════════════════════════════════════════════════════════
def fill_slide24(slide):
    title_group(slide,
                '個股 Buy 訊號回測詳細結果',
                'PER-SYMBOL BUY SIGNAL BACKTEST',
                '以排除測試股票後重新訓練的模型，測試 2025 年後的 Buy 訊號品質。勝率 = 訊號次日真實上漲比例。',
                sid_start=400)

    symbols = [
        ('AMD',  '半導體',  '87.7%', '+3.15%', '73',  GREEN_C),
        ('META', '科技',    '82.6%', '+2.10%', '46',  GREEN_C),
        ('INTC', '半導體',  '73.3%', '+2.97%', '86',  TITLE_C),
        ('ALAB', 'AI晶片',  '74.4%', '+2.95%', '121', TITLE_C),
        ('O',    'REIT',   '47.8%', '+0.07%', '23',  RED_C),
    ]

    CARD_W = 1680000
    CARD_H = 3400000
    GAP    = 110000
    LX     = 300000
    TY     = 1090000

    els = []
    sid = 410

    for i, (sym, sector, win, ret, sigs, col) in enumerate(symbols):
        cx_ = LX + i * (CARD_W + GAP)
        is_bad = sym == 'O'
        card_fill = CARD if not is_bad else "1A0C10"

        els.append(_xml(cx_, TY, CARD_W, CARD_H, sid, f'Card{i}', fill=card_fill))
        sid += 1

        # Sector badge
        els.append(_xml(cx_ + 80000, TY + 80000, CARD_W - 160000, 150000, sid, f'SBadge{i}',
                        fill=CARD_M if not is_bad else "3D1F1F",
                        prst='roundRect', adj=16667,
                        paragraphs=[P(T(sector, FB, 7.5, BODY_C), align='c')], anchor='ctr'))
        sid += 1

        # Symbol name
        els.append(_xml(cx_, TY + 260000, CARD_W, 280000, sid, f'SymName{i}',
                        no_fill=True, inset=0,
                        paragraphs=[P(T(sym, FT, 18, col), align='c')]))
        sid += 1

        # Win rate (big number)
        els.append(_xml(cx_, TY + 600000, CARD_W, 380000, sid, f'WinRate{i}',
                        no_fill=True, inset=0,
                        paragraphs=[
                            P(T(win, FT, 26, col), align='c', lnspc='90000'),
                            P(T('Buy 勝率', FB, 7.5, BODY_C), align='c'),
                        ]))
        sid += 1

        # Divider
        els.append(_xml(cx_ + 100000, TY + 1080000, CARD_W - 200000, 30000, sid, f'Div{i}',
                        fill=CARD_M))
        sid += 1

        # Avg return
        ret_col = GREEN_C if ret.startswith('+') and float(ret[1:-1]) > 0.5 else RED_C
        els.append(_xml(cx_, TY + 1160000, CARD_W, 600000, sid, f'RetBox{i}',
                        no_fill=True, inset=40000,
                        paragraphs=[
                            P(T('平均隔日報酬', FB, 7.5, BODY_C), align='c'),
                            P(T(ret, FT, 20, ret_col), align='c', lnspc='90000'),
                        ]))
        sid += 1

        # Signal count
        els.append(_xml(cx_, TY + 1900000, CARD_W, 500000, sid, f'SigBox{i}',
                        no_fill=True, inset=40000,
                        paragraphs=[
                            P(T('訊號數 (2025～)', FB, 7.5, BODY_C), align='c'),
                            P(T(sigs, FT, 20, TITLE_C), align='c', lnspc='90000'),
                        ]))
        sid += 1

        # Verdict
        verdict = '泛化不佳（REIT）' if is_bad else '✅ 泛化良好'
        verd_col = RED_C if is_bad else GREEN_C
        els.append(_xml(cx_ + 60000, TY + 2550000, CARD_W - 120000, 700000, sid, f'Verdict{i}',
                        fill=CARD_M if not is_bad else "3D1F1F",
                        prst='roundRect', adj=10000,
                        paragraphs=[
                            P(T(verdict, FB, 8, verd_col), align='c'),
                        ], anchor='ctr'))
        sid += 1

    add_to(slide, els)


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════
def remove_images(slide):
    """Remove all PICTURE shapes from a slide."""
    to_remove = [s._element for s in slide.shapes if s.shape_type == 13]
    for el in to_remove:
        el.getparent().remove(el)


def main():
    prs = Presentation(PPTX_IN)
    slides = prs.slides

    # Slide 14: add actual metrics bar below existing comparison table
    print("Updating slide 14...")
    update_slide14(slides[13])

    # Slides 17 and 20 already have good chart images — skip them

    # Slide 22: delete placeholder image, add cross-stock validation table
    print("Filling slide 22...")
    remove_images(slides[21])
    fill_slide22(slides[21])

    # Slide 24: delete placeholder image, add per-symbol result cards
    print("Filling slide 24...")
    remove_images(slides[23])
    fill_slide24(slides[23])

    prs.save(PPTX_OUT)
    print(f"\nSaved → {PPTX_OUT}")


if __name__ == '__main__':
    main()
