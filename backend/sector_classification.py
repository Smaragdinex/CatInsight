"""
靜態產業分類：標記「景氣循環 / 商品驅動」產業。

核心用途：讓排序模型學到「循環股的財報/價格榮景容易均值回歸」——
也就是疫情二手車、郵輪、戰爭石油、黃金這類「一時的、非長久的」榮景。

這是靜態對照（公司產業屬性不隨時間變），故無回測 lookahead 風險。
未列入者預設 is_cyclical=0（視為結構成長/防禦型，如半導體、軟體、醫療、必需消費）。
"""

# ── 景氣循環 / 商品驅動族群（榮景易反轉）──────────────────────────────
# 能源（石油天然氣）：油價/戰爭驅動，週期性極強
_ENERGY = {
    "XOM", "CVX", "COP", "EOG", "SLB", "MPC", "PSX", "VLO", "OXY", "WMB",
    "KMI", "OKE", "HAL", "DVN", "FANG", "BKR", "HES", "MRO", "APA", "EQT",
    "CTRA", "TRGP", "MPLX", "EPD", "ET", "PXD", "COG", "NOV", "FTI", "RRC",
    "AR", "CNX", "LNG", "MUR", "OVV", "SM",
}
# 原物料：金屬礦業（黃金）、化工、鋼鐵、紙漿——商品價格驅動
_MATERIALS = {
    "FCX", "NEM", "DOW", "LYB", "CF", "MOS", "NUE", "STLD", "CE", "EMN",
    "ALB", "IFF", "FMC", "IP", "PKG", "AMCR", "BALL", "AVY", "SEE", "MLM",
    "VMC", "DD", "PPG", "CTVA", "X", "CLF", "AA", "MP", "ATI",
}
# 航空——油價/景氣/消費循環
_AIRLINES = {"LUV", "DAL", "UAL", "AAL", "ALK", "JBLU", "SAVE", "HA"}
# 郵輪——疫情後復甦、消費循環，beat-but-revert 經典
_CRUISE = {"CCL", "RCL", "NCLH"}
# 賭場 / 飯店 / 度假村——消費循環
_CASINO_HOTEL = {"LVS", "WYNN", "MGM", "CZR", "PENN", "DKNG", "BYD"}
# 汽車 / 二手車——疫情二手車榮景(CVNA)、整車廠週期
_AUTO = {"F", "GM", "CVNA", "APTV", "BWA", "LKQ", "GT", "AN", "KMX", "GPC"}
# 房屋建商——利率/景氣循環
_HOMEBUILDER = {"DHI", "LEN", "PHM", "NVR", "TOL", "KBH", "MHK", "PHM"}

# 合併
CYCLICAL_TICKERS = (
    _ENERGY | _MATERIALS | _AIRLINES | _CRUISE
    | _CASINO_HOTEL | _AUTO | _HOMEBUILDER
)

# 細分組別（之後若要更細的特徵可用）
CYCLICAL_GROUP = {}
for _grp, _set in [
    ("energy", _ENERGY), ("materials", _MATERIALS), ("airline", _AIRLINES),
    ("cruise", _CRUISE), ("casino_hotel", _CASINO_HOTEL),
    ("auto", _AUTO), ("homebuilder", _HOMEBUILDER),
]:
    for _t in _set:
        CYCLICAL_GROUP[_t] = _grp


# ── 高風險投機股排除清單（事後過濾，不進模型、零重訓 churn）──────────────
# 資料依據：12 期雙週回測中反覆被選中卻持續虧損、且無法用通用規則(波動率)區分。
# CVNA：9 期進榜 7 期跌、累計約 -91%，業務本質(二手車零售/疫情榮景/高債)非結構成長。
# 維護準則：只放「反覆進榜、反覆虧、且非半導體/結構成長」的明確慣犯。
SPECULATIVE_EXCLUDE = {
    "CVNA",
}


def is_speculative_excluded(symbol: str) -> bool:
    """是否在高風險投機股排除清單中（事後過濾用）。"""
    return (symbol or "").upper() in SPECULATIVE_EXCLUDE


def is_cyclical(symbol: str) -> float:
    """回傳 1.0 若為景氣循環/商品驅動產業，否則 0.0。"""
    return 1.0 if (symbol or "").upper() in CYCLICAL_TICKERS else 0.0


def cyclical_group(symbol: str) -> str:
    """回傳細分組別字串，非循環回 ''。"""
    return CYCLICAL_GROUP.get((symbol or "").upper(), "")
