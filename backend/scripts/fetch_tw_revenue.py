"""抓台股上市/上櫃月營收(TWSE/TPEx OpenAPI)。存 data/tw_revenue/{code}.json 時間序列。
OpenAPI 只給「當月」快照 → 每月跑一次累積歷史。歷史回補需 MOPS(另議)。"""
import json, sys
from pathlib import Path
import httpx

OUT = Path("data/tw_revenue"); OUT.mkdir(parents=True, exist_ok=True)
SRC = {
    "TWSE": "https://openapi.twse.com.tw/v1/opendata/t187ap05_L",   # 上市
    "TPEX": "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O", # 上櫃
}

def _num(s):
    try: return float(str(s).replace(",", ""))
    except: return None

def run():
    total = 0
    with httpx.Client(timeout=40, headers={"User-Agent": "Mozilla/5.0"}, verify=False) as c:
        for mkt, url in SRC.items():
            try:
                rows = c.get(url).json()
            except Exception as e:
                print("FAIL", mkt, e); continue
            for r in rows:
                code = r.get("公司代號") or r.get("Code")
                ym   = r.get("資料年月") or r.get("Date")
                if not code or not ym: continue
                rec = {
                    "month": ym,
                    "revenue": _num(r.get("營業收入-當月營收") or r.get("Revenue")),
                    "yoy": _num(r.get("營業收入-去年同月增減(%)")),
                    "mom": _num(r.get("營業收入-上月比較增減(%)")),
                }
                p = OUT / f"{code}.json"
                hist = json.loads(p.read_text(encoding="utf-8")) if p.exists() else []
                hist = [h for h in hist if h.get("month") != ym]  # 去重
                hist.append(rec); hist.sort(key=lambda x: x["month"])
                p.write_text(json.dumps(hist, ensure_ascii=False), encoding="utf-8")
                total += 1
            print(f"{mkt}: {len(rows)} 家")
    print("更新", total, "筆月營收")

if __name__ == "__main__":
    run()
