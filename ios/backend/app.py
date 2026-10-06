from typing import List, Literal, Optional
import os
import json
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="MyStockApp AI Analysis API", version="1.0.0")


SYSTEM_PROMPT = """
You are a disciplined short-term stock analysis assistant.

Your job is to analyze exactly ONE stock at a time using only the provided input.
You must remain conservative, factual, and risk-aware.

## Primary Objective
Generate a short-term AI analysis for the current stock only.

## Hard Rules
1. Analyze ONLY the provided stock symbol and company name.
2. Do NOT mention any other company, ticker, brand, or competitor unless that exact information is explicitly provided in the input and is directly relevant.
3. If a sentence would mention another company not explicitly allowed by input, remove that sentence.
4. Do NOT hallucinate:
   - technical indicators
   - price levels
   - support/resistance
   - capital flow
   - sector drivers
   - news catalysts
   - earnings commentary
   unless they are explicitly present in the input.
5. If evidence is weak, mixed, incomplete, or unclear, prefer:
   - confidence = Low or Medium
   - sentiment = neutral
   - action = Wait
6. Never use overconfident language such as:
   - definitely
   - certainly
   - guaranteed
   - must rise
   - must fall
7. Keep reasoning concise, concrete, and directly tied to the input.
8. If predictedLow / predictedHigh are missing, return null instead of inventing values.
9. If the provided text contains information that appears unrelated to the current stock, ignore it.
10. Do not output markdown. Output valid JSON only.

## Analysis Policy
- Buy:
  Use only when signals are clearly supportive and reasonably consistent.
- Wait:
  Use when evidence is mixed, incomplete, neutral, or not strong enough.
- Avoid:
  Use when weakness, downside risk, or negative evidence is more clearly supported.

## Style
- Calm
- Analytical
- Risk-aware
- Capital-preservation first
- Short sentences
- No hype
- No storytelling
- No peer comparison unless explicitly required

## Required JSON Output
Return a valid JSON object with exactly this structure:
{
  "action": "Buy | Wait | Avoid",
  "confidence": "High | Medium | Low",
  "predictedLow": number or null,
  "predictedHigh": number or null,
  "summary": "short summary based only on the current stock",
  "technical": ["technical point 1", "technical point 2", "technical point 3"],
  "sentiment": {
    "label": "bullish | neutral | bearish",
    "items": ["sentiment point 1", "sentiment point 2"]
  },
  "watchPoints": ["watch item 1", "watch item 2", "watch item 3"]
}
""".strip()


class IndicatorInput(BaseModel):
    rsi: Optional[float] = None
    mfi: Optional[float] = None
    signal: Optional[str] = None


class AnalysisInput(BaseModel):
    symbol: str
    companyName: str
    language: str = "zh-TW"
    currentPrice: Optional[float] = None
    predictedLow: Optional[float] = None
    predictedHigh: Optional[float] = None
    bias: Optional[str] = None
    confidence: Optional[str] = None
    technicalSummary: Optional[str] = None
    newsImpact: Optional[str] = None
    newsSummary: Optional[str] = None
    indicators: IndicatorInput = Field(default_factory=IndicatorInput)
    marketContext: Optional[str] = None


class SentimentOutput(BaseModel):
    label: Literal["bullish", "neutral", "bearish"]
    items: List[str]


class AnalysisOutput(BaseModel):
    action: Literal["Buy", "Wait", "Avoid"]
    confidence: Literal["High", "Medium", "Low"]
    predictedLow: Optional[float] = None
    predictedHigh: Optional[float] = None
    summary: str
    technical: List[str]
    sentiment: SentimentOutput
    watchPoints: List[str]


def build_user_prompt(payload: AnalysisInput) -> str:
    return (
        "Analyze the following stock using the system rules.\n\n"
        "Current stock input:\n"
        f"{json.dumps(payload.model_dump(), ensure_ascii=False, indent=2)}\n\n"
        "Important:\n"
        "- Only analyze this stock.\n"
        "- Ignore any unrelated company reference if present.\n"
        "- If the input is incomplete, stay conservative.\n"
        "- Return JSON only."
    )


def _ollama_chat(prompt: str, model: str = "qwen2.5:14b") -> str:
    payload = {"model": model, "prompt": prompt, "stream": False}
    req = Request(
        "http://127.0.0.1:11434/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urlopen(req, timeout=300) as response:
        data = json.loads(response.read().decode("utf-8"))
    return data.get("response", "")


def _fallback_analysis(payload: AnalysisInput) -> AnalysisOutput:
    rsi = payload.indicators.rsi
    mfi = payload.indicators.mfi
    action = "Wait"
    confidence = "Medium"
    if rsi is not None and mfi is not None:
        if rsi <= 35 and mfi >= 50:
            action, confidence = "Buy", "High"
        elif rsi >= 70 and mfi < 50:
            action, confidence = "Avoid", "High"

    return AnalysisOutput(
        action=action,
        confidence=confidence,
        predictedLow=payload.predictedLow,
        predictedHigh=payload.predictedHigh,
        summary=payload.technicalSummary or "訊號偏中性，先觀察。",
        technical=[
            f"RSI={rsi if rsi is not None else 'N/A'}",
            f"MFI={mfi if mfi is not None else 'N/A'}",
            "模型不可用時採保守回退",
        ],
        sentiment=SentimentOutput(label="neutral", items=[payload.newsSummary or "目前沒有額外新聞優勢"]),
        watchPoints=["是否站回短期均線", "量能是否放大並延續", "是否突破預測區間上緣"],
    )


@app.get("/health")
def health():
    return {"ok": True, "engine": "ollama"}


@app.post("/api/ai/analyze", response_model=AnalysisOutput)
def analyze_stock(payload: AnalysisInput):
    user_prompt = build_user_prompt(payload)

    try:
        raw_text = _ollama_chat(user_prompt, model=os.getenv("OLLAMA_MODEL", "qwen2.5:14b"))
        data = json.loads(raw_text)
        return AnalysisOutput.model_validate(data)
    except Exception:
        return _fallback_analysis(payload)
