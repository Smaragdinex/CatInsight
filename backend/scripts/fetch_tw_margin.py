"""抓台股上市融資融券餘額(TWSE MI_MARGN),存 data/tw_margin/{code}.json。
散戶槓桿訊號:融資餘額(高=散戶多,常為反指標)、融券餘額(空方)。"""
import json, sys, time
from pathlib import Path
import httpx

OUT = Path("data/tw_margin"); OUT.mkdir(parents=True, exist_ok=True)
START = sys.argv[1] if len(sys.argv) > 1 else "2022-06-01"

def num(s):
    try: return int(str(s).replace(",", ""))
    except: return None

def run():
    dates = [r["date"] for r in json.loads(Path("data/history_tw/2330.TW.json").read_text()) if r["date"] >= START]
    print(f"融資券回補 {len(dates)} 交易日", flush=True)
    store = {}
    with httpx.Client(timeout=40, verify=False, headers={"User-Agent": "Mozilla/5.0"}) as c:
        for n, dt in enumerate(dates):
            j = None
            for attempt in range(3):
                try:
                    resp = c.get(f"https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date={dt.replace('-','')}&selectType=ALL&response=json")
                    jj = resp.json()
                    if jj.get("stat") == "OK":
                        j = jj; break
                except Exception:
                    pass
                time.sleep(2.0)
            if j is None:
                continue
            try:
                tb = next((t for t in j["tables"] if len(t.get("data", [])) > 100), None)
                if not tb: continue
                for row in tb["data"]:
                    code = str(row[0]).strip()
                    if not code.isdigit() or len(code) != 4: continue
                    store.setdefault(code, []).append({
                        "date": dt,
                        "margin_bal": num(row[6]),    # 融資今日餘額
                        "short_bal": num(row[12]),    # 融券今日餘額
                        "margin_chg": (num(row[6]) - num(row[5])) if num(row[6]) is not None and num(row[5]) is not None else None,
                    })
            except Exception:
                pass
            if n % 50 == 0: print(f"{n}/{len(dates)} {dt} 累積{len(store)}", flush=True)
            time.sleep(1.3)
    for code, rows in store.items():
        rows.sort(key=lambda x: x["date"])
        (OUT / f"{code}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print("完成融資券:", len(store), "檔", flush=True)

if __name__ == "__main__":
    run()
