"""抓台股上市三大法人買賣超(TWSE T86),建每股時間序列。data/tw_institutional/{code}.json
每日一個請求抓全個股。預設回補近 N 年交易日(以 2330 歷史日期為準)。"""
import json, sys, time
from pathlib import Path
import httpx

OUT = Path("data/tw_institutional"); OUT.mkdir(parents=True, exist_ok=True)
START = sys.argv[1] if len(sys.argv) > 1 else "2022-06-01"

def num(s):
    try: return int(str(s).replace(",", ""))
    except: return None

def trading_dates():
    d = json.loads(Path("data/history_tw/2330.TW.json").read_text())
    return [r["date"] for r in d if r["date"] >= START]

def run():
    dates = trading_dates()
    print(f"回補 {len(dates)} 個交易日 ({dates[0]}~{dates[-1]})", flush=True)
    store = {}   # code -> list
    with httpx.Client(timeout=40, verify=False, headers={"User-Agent": "Mozilla/5.0"}) as c:
        for n, dt in enumerate(dates):
            ymd = dt.replace("-", "")
            try:
                j = c.get(f"https://www.twse.com.tw/rwd/zh/fund/T86?date={ymd}&selectType=ALL&response=json").json()
                if j.get("stat") != "OK": continue
                f = j["fields"]
                def idx(name): return next(i for i, x in enumerate(f) if name in x)
                ic, ifor, itr, idl, itot = idx("證券代號"), idx("外陸資買賣超股數(不含外資自營商)"), idx("投信買賣超股數"), idx("自營商買賣超股數"), idx("三大法人買賣超股數")
                for row in j["data"]:
                    code = row[ic].strip()
                    if not code.isdigit() or len(code) != 4: continue
                    store.setdefault(code, []).append({
                        "date": dt, "foreign": num(row[ifor]), "trust": num(row[itr]),
                        "dealer": num(row[idl]), "total": num(row[itot]),
                    })
            except Exception:
                pass
            if n % 50 == 0:
                print(f"{n}/{len(dates)} {dt}  個股累積 {len(store)}", flush=True)
            time.sleep(0.4)
    for code, rows in store.items():
        rows.sort(key=lambda x: x["date"])
        (OUT / f"{code}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print("完成:", len(store), "檔個股法人資料", flush=True)

if __name__ == "__main__":
    run()
