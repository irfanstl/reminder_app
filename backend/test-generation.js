require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGeneration() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  try {
    const result = await model.generateContent("Say hello");
    const response = await result.response;
    console.log(response.text());
  } catch (error) {
    console.error(error);
  }
}
testGeneration();
