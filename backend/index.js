const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/smart-reminder';

// Keep-Alive System for Render Free Tier
const https = require('https');
setInterval(() => {
  https.get('https://reminder-app-mzg1.onrender.com/api/ping', (res) => {
    console.log('Self-ping successful: Staying awake!');
  }).on('error', (err) => {
    console.log('Self-ping error: ' + err.message);
  });
}, 840000); // Ping every 14 minutes (Render sleeps after 15)

app.get('/api/ping', (req, res) => res.send('pong'));

console.log("URI IS:", MONGO_URI);
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB Database!'))
  .catch(err => console.error('MongoDB connection error. Please set a valid MONGO_URI in your .env file.', err));

const reminderSchema = new mongoose.Schema({
  task: { type: String, required: true },
  time: { type: String },
  date: { type: String },
  category: { type: String, default: 'other' },
  priority: { type: String, default: 'medium' },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date },
  
  // New engine fields
  description: { type: String },
  datetime: { type: String },
  is_recurring: { type: Boolean, default: false },
  recurrence_rule: { type: String },
  location: { type: String },
  contacts: [{ type: String }],
  tags: [{ type: String }],
  confidence: { type: Number },
  raw_input: { type: String }
}, { timestamps: true });
const Reminder = mongoose.model('Reminder', reminderSchema);

const messageSchema = new mongoose.Schema({
  type: { type: String, enum: ['bot', 'user'], required: true },
  text: { type: String, required: true },
}, { timestamps: true });
const Message = mongoose.model('Message', messageSchema);

let genAI;
let model;
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
}
console.log("GEMINI KEY LOADED?", !!process.env.GEMINI_API_KEY, "MODEL INSTANCE:", !!model);

async function generateWithFallback(prompt, systemInstruction) {
  if (!genAI) throw new Error("GoogleGenerativeAI not initialized");
  const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite'];
  for (const modelName of modelsToTry) {
    try {
      const dynamicModel = genAI.getGenerativeModel({ 
        model: modelName,
        systemInstruction: systemInstruction,
        generationConfig: {
          response_mime_type: "application/json",
        }
      });
      const result = await dynamicModel.generateContent(prompt);
      return result;
    } catch (err) {
      if (err.status === 429) {
        console.warn(`[Rate Limit] ${modelName} exhausted, falling back to next model...`);
        continue; // Try the next model
      }
      throw err;
    }
  }
  const err = new Error("All AI models have exhausted their rate limits!");
  err.status = 429;
  throw err;
}

app.get('/api/reminders', async (req, res) => {
  try {
    const { completed } = req.query;
    let filter = {};
    if (completed !== undefined) filter.completed = completed === 'true';
    const reminders = await Reminder.find(filter).sort({ createdAt: -1 });
    res.json(reminders);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const messages = await Message.find().sort({ createdAt: 1 }).limit(100);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    const newMessage = new Message(req.body);
    await newMessage.save();
    res.json(newMessage);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save message' });
  }
});

app.post('/api/parse-reminder', async (req, res) => {
  const { text, history } = req.body;
  if (!text) return res.status(400).json({ error: 'Text input is required' });

  let parsedData = null;

  if (model) {
    try {
      const currentDatetime = new Date().toString();
      const systemInstruction = `You are a reminder extraction engine for a task management app.
Current Date/Time: ${currentDatetime}
User Timezone: IST (UTC+5:30)

Your job: parse a user's message and return a JSON object matching the requested schema.

RULES:
- If the user wants to set a reminder but DOES NOT provide a time, date, or relative time (e.g. they just say "remind me to study" or "add a task to read"), you MUST set intent to "clarify" and ask them what time they want to be reminded.
- If the message contains no actionable reminder and no cancellation intent, return: {"error": "no_reminder_found"}
- Never invent information the user did not provide. Use null for missing fields.

OUTPUT SCHEMA:
{
  "intent": "create" | "cancel" | "clarify",
  "clarification_message": "string | null — If intent is 'clarify', politely ask the user for the missing time or date.",
  "cancel_target": "string | null",
  "title": "string | null",
  "description": "string | null",
  "datetime": "string | null — MUST BE a valid ISO 8601 string (e.g. '2026-05-03T05:00:00+05:30'). Resolve relative times using Current Date/Time.",
  "is_recurring": boolean,
  "recurrence_rule": "string | null",
  "priority": "low | medium | high | critical",
  "category": "string | null",
  "location": "string | null",
  "contacts": ["string"],
  "tags": ["string"],
  "confidence": number,
  "raw_input": "string"
}`;

      const prompt = `Recent Chat History:\n${history || 'None'}\n\nCurrent User Message: "${text}"\n\nExtract the final reminder details. Use the Chat History to fill in missing context (e.g. if User says '5 PM', check the history to see what task they are referring to).`;
      const result = await generateWithFallback(prompt, systemInstruction);
      const resultText = (await result.response).text().trim();
      console.log("RAW AI RESPONSE:", resultText);
      try {
        parsedData = JSON.parse(resultText);
      } catch (e) {
        console.error('Failed to parse Gemini JSON:', e, resultText);
      }
    } catch (err) {
      console.error('Gemini error:', err);
      if (err.status === 429) {
        return res.status(429).json({ error: "Google's AI Rate Limit hit! Please wait about 30 seconds before sending another message." });
      }
    }
  }

  if (parsedData) {
    console.log('\n--- AI RAW JSON OUTPUT ---');
    console.log(JSON.stringify(parsedData, null, 2));
    console.log('--------------------------\n');
  }

  if (parsedData && parsedData.intent === 'clarify') {
    return res.json(parsedData); // Return clarification to frontend
  }

  if (parsedData && parsedData.error) {
    return res.status(400).json({ error: 'No actionable reminder found.' });
  }

  if (parsedData && parsedData.intent === 'cancel' && parsedData.cancel_target) {
    try {
      const keywords = parsedData.cancel_target.split(' ').filter(w => w.length > 2);
      let query = { completed: false };
      if (keywords.length > 0) {
        query.task = { $regex: new RegExp(keywords[0], 'i') };
      }
      const toDelete = await Reminder.findOne(query).sort({ createdAt: -1 });
      if (toDelete) {
        await Reminder.findByIdAndDelete(toDelete._id);
        return res.json({ action: 'cancelled', task: toDelete.task });
      } else {
        return res.status(400).json({ error: "Couldn't find a pending task matching that description to cancel." });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Failed to process cancellation' });
    }
  }

  if (!parsedData) {
    parsedData = { title: text, priority: 'medium', category: 'other' };
  }

  let timeStr = '';
  let dateStr = 'today';
  if (parsedData.datetime) {
    const dt = new Date(parsedData.datetime);
    if (!isNaN(dt)) {
      const hours = dt.getHours().toString().padStart(2, '0');
      const mins = dt.getMinutes().toString().padStart(2, '0');
      timeStr = `${hours}:${mins}`;
      const year = dt.getFullYear();
      const month = (dt.getMonth() + 1).toString().padStart(2, '0');
      const day = dt.getDate().toString().padStart(2, '0');
      dateStr = `${year}-${month}-${day}`;
    }
  }

  try {
    const newReminder = new Reminder({
      task: parsedData.title || text,
      time: timeStr,
      date: dateStr,
      category: parsedData.category || 'other',
      priority: parsedData.priority || 'medium',
      
      description: parsedData.description,
      datetime: parsedData.datetime,
      is_recurring: parsedData.is_recurring,
      recurrence_rule: parsedData.recurrence_rule,
      location: parsedData.location,
      contacts: parsedData.contacts || [],
      tags: parsedData.tags || [],
      confidence: parsedData.confidence,
      raw_input: parsedData.raw_input || text
    });
    await newReminder.save();
    res.json(newReminder);
  } catch (err) {
    console.error('MongoDB save error:', err);
    res.status(500).json({ error: 'Failed to save reminder' });
  }
});

app.post('/api/antigravity', async (req, res) => {
  const { prompt, tasks } = req.body;
  if (!prompt || !tasks) return res.status(400).json({ error: 'Prompt and tasks are required' });

  if (model) {
    try {
      const systemInstruction = `You are "Antigravity", an intelligent task manager assistant.
Your job is to smartly process tasks based on user requests. 
- You can reschedule overdue tasks.
- You can change "priority" to "high" or "normal" based on urgency.
- You can re-categorize items.
- Return ONLY a JSON array of the updated tasks. 
- Each object in the array MUST contain its original "_id" field.`;

      const prompt = `Process these tasks based on: "${prompt}"\n\nTasks: ${JSON.stringify(tasks)}`;
      const result = await generateWithFallback(prompt, systemInstruction);
      const resultText = (await result.response).text().trim();
      let updatedTasks = [];
      try {
        const jsonStr = resultText.replace(/```json/g, '').replace(/```/g, '');
        updatedTasks = JSON.parse(jsonStr);
      } catch (e) {
        console.error('Failed to parse AI JSON response:', e, resultText);
        return res.status(500).json({ error: 'AI parsing failed' });
      }

      // Bulk update in DB
      for (const t of updatedTasks) {
        if (t._id) {
          await Reminder.findByIdAndUpdate(t._id, { 
            time: t.time, 
            date: t.date, 
            category: t.category, 
            priority: t.priority 
          });
        }
      }
      
      res.json({ success: true, updatedCount: updatedTasks.length });
    } catch (err) {
      console.error('AI logic error:', err);
      res.status(500).json({ error: 'AI processing failed' });
    }
  } else {
    res.status(500).json({ error: 'AI Model not initialized' });
  }
});

app.put('/api/reminders/:id', async (req, res) => {
  try {
    const { task, time, date, category, completed, priority } = req.body;
    const updateData = {};
    if (task !== undefined) updateData.task = task;
    if (time !== undefined) updateData.time = time;
    if (date !== undefined) updateData.date = date;
    if (category !== undefined) updateData.category = category;
    if (priority !== undefined) updateData.priority = priority;
    if (completed !== undefined) {
      updateData.completed = completed;
      if (completed) updateData.completedAt = new Date();
    }
    const updated = await Reminder.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

app.delete('/api/reminders/:id', async (req, res) => {
  try {
    await Reminder.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
