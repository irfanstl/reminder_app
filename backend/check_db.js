const mongoose = require('mongoose');

const MONGO_URI = 'mongodb+srv://irfan07:irfan07@cluster0.cjm7bz5.mongodb.net/test?appName=Cluster0';

async function checkDb() {
  await mongoose.connect(MONGO_URI);
  
  const reminderSchema = new mongoose.Schema({}, { strict: false });
  const Reminder = mongoose.model('Reminder', reminderSchema);
  
  const reminders = await Reminder.find().sort({ createdAt: -1 }).limit(5);
  console.log("Recent reminders:");
  reminders.forEach(r => {
    console.log(`Task: ${r.task} | Time: ${r.time} | Date: ${r.date} | Raw Input: ${r.raw_input} | Datetime: ${r.datetime}`);
  });
  
  process.exit(0);
}

checkDb();
