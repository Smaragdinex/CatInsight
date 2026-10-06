# MyStockApp AI Analysis Backend (FastAPI)

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Ollama should be running locally
export OLLAMA_MODEL=qwen2.5:14b
uvicorn app:app --reload --port 8000

# Railway / production:
# Procfile will be used automatically:
# web: uvicorn app:app --host 0.0.0.0 --port $PORT
# Environment variable:
# OLLAMA_MODEL=qwen2.5:14b
```

## Endpoint

### POST `/api/ai/analyze`

Request example:

```json
{
  "symbol": "MRVL",
  "companyName": "Marvell Technology",
  "language": "zh-TW",
  "currentPrice": 61.2,
  "predictedLow": 59.5,
  "predictedHigh": 62.8,
  "bias": "neutral",
  "confidence": "medium",
  "technicalSummary": "Momentum is softening. RSI remains elevated but no confirmed breakdown.",
  "newsImpact": "neutral",
  "newsSummary": "No major company-specific catalyst. Sector tone remains mixed.",
  "indicators": {
    "rsi": 67.5,
    "mfi": 45.2,
    "signal": "Neutral"
  },
  "marketContext": "Semiconductor sector mixed, risk appetite not strong."
}
```

Response example:

```json
{
  "action": "Wait",
  "confidence": "Medium",
  "predictedLow": 59.5,
  "predictedHigh": 62.8,
  "summary": "短線訊號仍偏混合，動能略有轉弱，現階段較適合等待更明確方向。",
  "technical": [
    "RSI 仍偏高，短線有過熱壓力",
    "MFI 動能偏弱，資金延續性不足",
    "目前尚未出現明確突破或轉強確認"
  ],
  "sentiment": {
    "label": "neutral",
    "items": [
      "目前缺乏明確公司級利多催化",
      "產業氣氛偏中性，短線買盤信心有限"
    ]
  },
  "watchPoints": [
    "是否站回短期均線",
    "量能是否放大並延續",
    "是否突破預測區間上緣"
  ]
}
```
