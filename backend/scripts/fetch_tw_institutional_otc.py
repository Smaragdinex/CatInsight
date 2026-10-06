"""抓上櫃(TPEx)三大法人買賣超,存入 data/tw_institutional/{code}.json(與上市同夾)。"""
import json, sys, time
from pathlib import Path
import httpx

OUT = Path("data/tw_institutional"); OUT.mkdir(parents=True, exist_ok=True)
START = sys.argv[1] if len(sys.argv) > 1 else "2022-06-01"

def num(s):
    try: return int(str(s).replace(",", ""))
    except: return None

def trading_dates():
    # 用一檔上櫃股的歷史當交易日
    import glob
    for cand in ["data/history_tw/5483.TWO.json", "data/history_tw/6488.TWO.json", "data/history_tw/3260.TWO.json"]:
        p = Path(cand)
        if p.exists():
            return [r["date"] for r in json.loads(p.read_text()) if r["date"] >= START]
    return []

def run():
    dates = trading_dates()
    print(f"上櫃回補 {len(dates)} 交易日", flush=True)
    store = {}
    with httpx.Client(timeout=40, verify=False, headers={"User-Agent": "Mozilla/5.0"}) as c:
        for n, dt in enumerate(dates):
            d = dt.replace("-", "/")
            try:
                j = c.get(f"https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?type=Daily&sect=EW&date={d}&id=&response=json").json()
                if j.get("stat") != "ok": continue
                tb = j["tables"][0]; fields = tb["fields"]
                itot = next(i for i, x in enumerate(fields) if "三大法人買賣超股數合計" in x)
                for row in tb["data"]:
                    code = str(row[0]).strip()
                    if not code.isdigit() or len(code) != 4: continue
                    store.setdefault(code, []).append({
                        "date": dt, "foreign": num(row[10]), "trust": num(row[13]),
                        "dealer": num(row[22]), "total": num(row[itot]),
                    })
            except Exception:
                pass
            if n % 50 == 0: print(f"{n}/{len(dates)} {dt} 累積{len(store)}", flush=True)
            time.sleep(0.4)
    for code, rows in store.items():
        rows.sort(key=lambda x: x["date"])
        (OUT / f"{code}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print("完成上櫃:", len(store), "檔", flush=True)

if __name__ == "__main__":
    run()
