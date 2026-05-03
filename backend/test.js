require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

const currentDatetime = new Date().toString();
const prompt = `You are a reminder extraction engine for a task management app.

Your job: parse a user's natural language message and return a single, valid JSON object.

RULES:
- Return ONLY raw JSON. No markdown fences, no explanation, no preamble.
- If the message contains no actionable reminder and no cancellation intent, return: {"error": "no_reminder_found"}
- Never invent information the user did not provide. Use null for missing fields.
- Today's date and local time will be injected as: ${currentDatetime}.

OUTPUT SCHEMA:
{
  "intent": "create" | "cancel",
  "cancel_target": "string | null — If intent is 'cancel', extract keywords of the task they want to cancel",
  "title": "string | null — concise action title (max 8 words)",
  "description": "string | null — extra detail if present",
  "datetime": "string | null — MUST BE a valid ISO 8601 string (e.g. '2026-05-03T05:00:00+05:30'). DO NOT return raw text like '5 am'. Resolve relative times using CURRENT_DATETIME.",
  "is_recurring": boolean,
  "recurrence_rule": "string | null",
  "priority": "low | medium | high | critical",
  "category": "string | null — one of: work, health, personal, finance, family, travel, other",
  "location": "string | null",
  "contacts": ["string"],
  "tags": ["string"],
  "confidence": number,
  "raw_input": "string"
}

DATETIME RESOLUTION:
- 'tomorrow at 9' → next calendar day at 09:00 local time
- 'next Monday' → the coming Monday (not today even if today is Monday)
- 'in 2 hours' → CURRENT_DATETIME + 2 hours
- 'evening' → 18:00 if no specific time given
- 'morning' → 08:00 if no specific time given
- If only a time is given with no date, assume today if the time is in the future, otherwise tomorrow.

Input: "study at 5"`;

model.generateContent(prompt).then(r => {
    const text = r.response.text();
    console.log("RAW TEXT:", text);
    try {
        const json = JSON.parse(text.replace(/```json/g, '').replace(/```/g, ''));
        console.log("PARSED JSON:", json);
    } catch(e) {
        console.error("PARSE ERROR:", e);
    }
}).catch(console.error);
